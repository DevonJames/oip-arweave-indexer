/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MULTI-DESTINATION PUBLISHER - Publish to Arweave, GUN, and Internet Archive
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Handles publishing records to multiple destinations:
 *   - Arweave: Permanent blockchain storage (via OIP daemon)
 *   - GUN: Real-time peer synchronization (via OIP daemon)
 *   - Internet Archive: Anonymous submission via TOR
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { createTorProxiedClient, torRequest } = require('./torClient');
const settingsManager = require('./settingsManager');

// OIP Daemon URL
const OIP_DAEMON_URL = process.env.OIP_DAEMON_URL || 'http://oip-daemon-service:3005';

// In-memory submission tracking
const submissionStatus = new Map();

// Max submissions to track (prevent memory leak)
const MAX_SUBMISSIONS = 1000;

/**
 * Publish record to multiple destinations
 * 
 * @param {object} record - The OIP record to publish
 * @param {object} destinations - Which destinations to publish to
 * @param {string} userToken - JWT token for authenticated requests
 * @param {object} wordpress - WordPress metadata (postId, postType)
 * @returns {Promise<object>} Submission status
 */
async function publishRecord(record, destinations, userToken = null, wordpress = null) {
    const submissionId = `sub_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
    const startTime = Date.now();
    
    // Initialize submission status
    const status = {
        submissionId,
        status: 'processing',
        startedAt: new Date().toISOString(),
        completedAt: null,
        record: {
            type: record.recordType || getRecordType(record),
            name: record.basic?.name || 'Untitled'
        },
        wordpress: wordpress || null,
        results: {
            arweave: { status: 'pending' },
            gun: { status: 'pending' },
            internetArchive: { status: 'pending' }
        }
    };
    
    // Store submission
    submissionStatus.set(submissionId, status);
    cleanupOldSubmissions();
    
    // Determine which destinations to publish to
    const publishToArweave = destinations.arweave !== false && settingsManager.isDestinationEnabled('arweave');
    const publishToGun = destinations.gun !== false && settingsManager.isDestinationEnabled('gun');
    const publishToInternetArchive = destinations.internetArchive !== false && settingsManager.isDestinationEnabled('internetArchive');
    
    // Skip disabled destinations
    if (!publishToArweave) status.results.arweave = { status: 'skipped', reason: 'destination disabled' };
    if (!publishToGun) status.results.gun = { status: 'skipped', reason: 'destination disabled' };
    if (!publishToInternetArchive) status.results.internetArchive = { status: 'skipped', reason: 'destination disabled' };
    
    // Publish to all enabled destinations concurrently
    const promises = [];
    
    if (publishToArweave) {
        promises.push(
            publishToArweaveDestination(record, userToken)
                .then(result => { status.results.arweave = result; })
                .catch(error => { status.results.arweave = { status: 'error', error: error.message }; })
        );
    }
    
    if (publishToGun) {
        promises.push(
            publishToGunDestination(record, userToken)
                .then(result => { status.results.gun = result; })
                .catch(error => { status.results.gun = { status: 'error', error: error.message }; })
        );
    }
    
    if (publishToInternetArchive) {
        promises.push(
            publishToInternetArchiveDestination(record, userToken)
                .then(result => { status.results.internetArchive = result; })
                .catch(error => { status.results.internetArchive = { status: 'error', error: error.message }; })
        );
    }
    
    // Wait for all publishing to complete
    await Promise.all(promises);
    
    // Update final status
    status.status = determineOverallStatus(status.results);
    status.completedAt = new Date().toISOString();
    status.duration = Date.now() - startTime;
    
    // Update stored status
    submissionStatus.set(submissionId, status);
    
    return status;
}

/**
 * Publish to Arweave via OIP daemon
 */
async function publishToArweaveDestination(record, userToken) {
    try {
        const response = await axios.post(
            `${OIP_DAEMON_URL}/api/records/newRecord?storage=arweave`,
            record,
            {
                headers: {
                    'Content-Type': 'application/json',
                    ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
                },
                timeout: 60000
            }
        );
        
        const data = response.data;
        response.data = null;
        
        return {
            status: 'success',
            did: data.did || data.didTx || data.transactionId,
            txId: data.transactionId || data.txId,
            gateway: 'arweave'
        };
        
    } catch (error) {
        throw new Error(`Arweave publish failed: ${error.response?.data?.error || error.message}`);
    }
}

/**
 * Publish to GUN via OIP daemon
 */
async function publishToGunDestination(record, userToken) {
    try {
        const response = await axios.post(
            `${OIP_DAEMON_URL}/api/records/newRecord?storage=gun`,
            record,
            {
                headers: {
                    'Content-Type': 'application/json',
                    ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {})
                },
                timeout: 60000
            }
        );
        
        const data = response.data;
        response.data = null;
        
        return {
            status: 'success',
            did: data.did || data.didTx,
            gateway: 'gun'
        };
        
    } catch (error) {
        throw new Error(`GUN publish failed: ${error.response?.data?.error || error.message}`);
    }
}

/**
 * Publish to Internet Archive via TOR
 */
async function publishToInternetArchiveDestination(record, userToken) {
    try {
        // Get IA gateway .onion address from organization record
        const iaOnionAddress = await getIAGatewayAddress();
        
        if (!iaOnionAddress) {
            return {
                status: 'skipped',
                reason: 'Internet Archive gateway address not configured'
            };
        }
        
        // Publish via TOR
        const client = createTorProxiedClient();
        
        const response = await client.post(
            `http://${iaOnionAddress}/api/records/newRecord`,
            record,
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 120000 // 2 minutes for TOR
            }
        );
        
        const data = response.data;
        response.data = null;
        
        return {
            status: 'success',
            did: data.did || data.didTx || data.transactionId,
            gateway: 'internet-archive',
            via: 'tor',
            onionAddress: iaOnionAddress
        };
        
    } catch (error) {
        // Check if it's a TOR connectivity issue
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return {
                status: 'error',
                error: 'TOR connection failed - ensure TOR daemon is running',
                via: 'tor'
            };
        }
        throw new Error(`Internet Archive publish failed: ${error.message}`);
    }
}

/**
 * Get Internet Archive gateway .onion address from organization record
 */
async function getIAGatewayAddress() {
    try {
        const iaOrgHandle = settingsManager.getSetting('iaOrganizationHandle') || 'internetarchive';
        
        // Query OIP daemon for IA organization
        const response = await axios.get(
            `${OIP_DAEMON_URL}/api/records`,
            {
                params: {
                    recordType: 'organization',
                    search: iaOrgHandle,
                    limit: 1
                },
                timeout: 10000
            }
        );
        
        const records = response.data?.records || [];
        
        if (records.length === 0) {
            console.log(`⚠️ Organization '${iaOrgHandle}' not found`);
            return null;
        }
        
        const org = records[0];
        const onionAddress = org.data?.gatewayOnionAddress || org.data?.gateway_onion_address;
        
        if (!onionAddress) {
            console.log(`⚠️ Organization '${iaOrgHandle}' has no gateway_onion_address`);
            return null;
        }
        
        return onionAddress;
        
    } catch (error) {
        console.error('Error fetching IA gateway address:', error.message);
        return null;
    }
}

/**
 * Get submission status by ID
 */
function getSubmissionStatus(submissionId) {
    return submissionStatus.get(submissionId) || null;
}

/**
 * Get recent submissions
 */
function getRecentSubmissions(limit = 10) {
    const submissions = Array.from(submissionStatus.values());
    return submissions
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .slice(0, limit);
}

/**
 * Helper: Determine record type from record structure
 */
function getRecordType(record) {
    if (record.post) return 'post';
    if (record.image) return 'image';
    if (record.video) return 'video';
    if (record.audio) return 'audio';
    if (record.recipe) return 'recipe';
    if (record.exercise) return 'exercise';
    return 'basic';
}

/**
 * Helper: Determine overall submission status
 */
function determineOverallStatus(results) {
    const statuses = Object.values(results).map(r => r.status);
    
    if (statuses.every(s => s === 'skipped')) return 'skipped';
    if (statuses.some(s => s === 'success')) return 'completed';
    if (statuses.every(s => s === 'error')) return 'failed';
    return 'partial';
}

/**
 * Helper: Cleanup old submissions to prevent memory leak
 */
function cleanupOldSubmissions() {
    if (submissionStatus.size > MAX_SUBMISSIONS) {
        const submissions = Array.from(submissionStatus.entries())
            .sort((a, b) => new Date(a[1].startedAt) - new Date(b[1].startedAt));
        
        // Remove oldest half
        const toRemove = submissions.slice(0, Math.floor(MAX_SUBMISSIONS / 2));
        for (const [id] of toRemove) {
            submissionStatus.delete(id);
        }
    }
}

module.exports = {
    publishRecord,
    getSubmissionStatus,
    getRecentSubmissions,
    publishToArweaveDestination,
    publishToGunDestination,
    publishToInternetArchiveDestination,
    getIAGatewayAddress
};

