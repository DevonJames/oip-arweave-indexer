/**
 * AR.IO Gateway Registry
 * 
 * Manages the list of available Arweave gateways with failover support.
 * Fetches live gateway list from AR.IO network on startup.
 */

const axios = require('axios');

// ═══════════════════════════════════════════════════════════════════════════
// HARDCODED TOP 20 GATEWAYS
// Ranked by join date and performance as of December 2024
// Source: https://gateways.ar.io/#/gateways
// ═══════════════════════════════════════════════════════════════════════════

const HARDCODED_GATEWAYS = [
    // Primary - always first
    { host: 'arweave.net', protocol: 'https', priority: 0 },
    
    // Top AR.IO Network gateways (by stake/performance)
    { host: 'ar-io.dev', protocol: 'https', priority: 1 },
    { host: 'arweave.developerdao.com', protocol: 'https', priority: 2 },
    { host: 'g8way.io', protocol: 'https', priority: 3 },
    { host: 'arweave.fllstck.dev', protocol: 'https', priority: 4 },
    { host: 'vilenarios.com', protocol: 'https', priority: 5 },
    { host: 'arweave.ar', protocol: 'https', priority: 6 },
    { host: 'permagate.io', protocol: 'https', priority: 7 },
    { host: 'arns.saikranthi.dev', protocol: 'https', priority: 8 },
    { host: 'love4src.com', protocol: 'https', priority: 9 },
    { host: 'gate.ardrive.io', protocol: 'https', priority: 10 },
    { host: 'ar.anyone.tech', protocol: 'https', priority: 11 },
    { host: 'iogate.uk', protocol: 'https', priority: 12 },
    { host: 'arweave.net.ru', protocol: 'https', priority: 13 },
    { host: 'gateways.0rbit.co', protocol: 'https', priority: 14 },
    { host: 'ar-ao.xyz', protocol: 'https', priority: 15 },
    { host: 'gateway.alex-popa.com', protocol: 'https', priority: 16 },
    { host: 'ariospeedwagon.com', protocol: 'https', priority: 17 },
    { host: 'ar.deno.dev', protocol: 'https', priority: 18 },
    { host: 'permapages.app', protocol: 'https', priority: 19 }
];

// Cache for dynamically fetched gateways
let dynamicGateways = [];
let lastFetchTime = 0;
const GATEWAY_CACHE_TTL = parseInt(process.env.GATEWAY_CACHE_TTL) || 3600000; // 1 hour default

// Gateway health metrics
const gatewayMetrics = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// GATEWAY REGISTRY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetches the current list of online gateways from AR.IO network.
 * Uses the ar.io smart contract / API to get registered gateways.
 * 
 * @returns {Promise<Array>} List of gateway objects
 */
async function fetchLiveGateways() {
    try {
        // AR.IO Gateway Registry API
        // This endpoint returns all registered gateways with their status
        const response = await axios.get('https://api.arns.app/v1/gateways', {
            timeout: 10000,
            headers: { 'Accept': 'application/json' }
        });
        
        if (response.data && response.data.gateways) {
            const gateways = Object.entries(response.data.gateways)
                .filter(([_, gw]) => gw.status === 'joined' && gw.settings?.fqdn)
                .map(([address, gw]) => ({
                    host: gw.settings.fqdn,
                    protocol: gw.settings.protocol || 'https',
                    port: gw.settings.port || (gw.settings.protocol === 'http' ? 80 : 443),
                    stake: gw.operatorStake || 0,
                    address: address,
                    joinedAt: gw.startTimestamp
                }))
                .sort((a, b) => b.stake - a.stake); // Sort by stake (highest first)
            
            console.log(`🌐 [Gateway Registry] Fetched ${gateways.length} live gateways from AR.IO`);
            dynamicGateways = gateways;
            lastFetchTime = Date.now();
            return gateways;
        }
        
        return [];
    } catch (error) {
        console.warn(`⚠️  [Gateway Registry] Failed to fetch live gateways: ${error.message}`);
        return [];
    }
}

/**
 * Gets all available gateways in priority order.
 * Combines hardcoded gateways with dynamically fetched ones.
 * 
 * @param {boolean} includeLocal - Whether to include local AR.IO gateway
 * @returns {Promise<Array>} Ordered list of gateway URLs
 */
async function getGatewayUrls(includeLocal = false) {
    const urls = [];
    
    // 1. Add arweave.net first (most reliable)
    urls.push('https://arweave.net');
    
    // 2. Add hardcoded gateways (excluding arweave.net which is already added)
    for (const gw of HARDCODED_GATEWAYS.slice(1)) {
        const url = `${gw.protocol}://${gw.host}`;
        if (!urls.includes(url)) {
            urls.push(url);
        }
    }
    
    // 3. Add local gateway if enabled (for decentralized profiles)
    if (includeLocal || process.env.USE_LOCAL_ARIO_GATEWAY === 'true') {
        const localAddress = process.env.LOCAL_ARIO_GATEWAY_ADDRESS || 'localhost:4000';
        try {
            const addressWithProtocol = localAddress.startsWith('http') 
                ? localAddress 
                : `http://${localAddress}`;
            const url = new URL(addressWithProtocol);
            const localUrl = `${url.protocol}//${url.host}`;
            // Add local gateway after arweave.net but before others
            urls.splice(1, 0, localUrl);
        } catch (error) {
            console.warn(`⚠️  Invalid LOCAL_ARIO_GATEWAY_ADDRESS: ${error.message}`);
        }
    }
    
    // 4. Add dynamically fetched gateways (refresh if cache expired)
    if (Date.now() - lastFetchTime > GATEWAY_CACHE_TTL) {
        await fetchLiveGateways();
    }
    
    for (const gw of dynamicGateways) {
        const port = gw.port && gw.port !== 443 && gw.port !== 80 ? `:${gw.port}` : '';
        const url = `${gw.protocol}://${gw.host}${port}`;
        if (!urls.includes(url)) {
            urls.push(url);
        }
    }
    
    return urls;
}

/**
 * Gets GraphQL endpoints for all available gateways.
 * 
 * @returns {Promise<Array>} List of GraphQL endpoint URLs
 */
async function getGraphQLEndpoints() {
    const baseUrls = await getGatewayUrls();
    return baseUrls.map(url => `${url}/graphql`);
}

/**
 * Initializes the gateway registry on startup.
 * Fetches live gateways and logs status.
 */
async function initializeGatewayRegistry() {
    console.log('🌐 [Gateway Registry] Initializing...');
    console.log(`   📋 Hardcoded gateways: ${HARDCODED_GATEWAYS.length}`);
    
    await fetchLiveGateways();
    
    const totalGateways = new Set([
        ...HARDCODED_GATEWAYS.map(g => g.host),
        ...dynamicGateways.map(g => g.host)
    ]).size;
    
    console.log(`   🔄 Dynamic gateways: ${dynamicGateways.length}`);
    console.log(`   ✅ Total unique gateways: ${totalGateways}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// GATEWAY HEALTH TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Records a successful request to a gateway.
 * 
 * @param {string} gatewayUrl - Gateway URL
 * @param {number} responseTime - Response time in ms
 */
function recordSuccess(gatewayUrl, responseTime) {
    const metrics = gatewayMetrics.get(gatewayUrl) || { 
        successes: 0, 
        failures: 0, 
        totalResponseTime: 0,
        lastSuccess: null,
        lastFailure: null
    };
    
    metrics.successes++;
    metrics.totalResponseTime += responseTime;
    metrics.lastSuccess = Date.now();
    
    gatewayMetrics.set(gatewayUrl, metrics);
}

/**
 * Records a failed request to a gateway.
 * 
 * @param {string} gatewayUrl - Gateway URL
 * @param {string} error - Error message
 */
function recordFailure(gatewayUrl, error) {
    const metrics = gatewayMetrics.get(gatewayUrl) || { 
        successes: 0, 
        failures: 0, 
        totalResponseTime: 0,
        lastSuccess: null,
        lastFailure: null
    };
    
    metrics.failures++;
    metrics.lastFailure = Date.now();
    metrics.lastError = error;
    
    gatewayMetrics.set(gatewayUrl, metrics);
}

/**
 * Gets health metrics for all gateways.
 * 
 * @returns {object} Gateway health metrics
 */
function getGatewayMetrics() {
    const result = {};
    for (const [url, metrics] of gatewayMetrics) {
        const total = metrics.successes + metrics.failures;
        result[url] = {
            ...metrics,
            successRate: total > 0 ? (metrics.successes / total * 100).toFixed(1) + '%' : 'N/A',
            avgResponseTime: metrics.successes > 0 
                ? Math.round(metrics.totalResponseTime / metrics.successes) + 'ms' 
                : 'N/A'
        };
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// FAILOVER REQUEST HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Makes a request with automatic failover across gateways.
 * 
 * @param {function} requestFn - Async function that takes gatewayUrl and returns result
 * @param {object} options - Options
 * @param {number} options.maxRetries - Max retries per gateway (default 1)
 * @param {number} options.timeout - Request timeout in ms (default 30000)
 * @returns {Promise<any>} Result from successful request
 * @throws {Error} If all gateways fail
 */
async function requestWithFailover(requestFn, options = {}) {
    const { maxRetries = 1, timeout = 30000 } = options;
    const gateways = await getGatewayUrls();
    const errors = [];
    
    for (const gatewayUrl of gateways) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const startTime = Date.now();
            try {
                const result = await Promise.race([
                    requestFn(gatewayUrl),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), timeout)
                    )
                ]);
                
                recordSuccess(gatewayUrl, Date.now() - startTime);
                return result;
                
            } catch (error) {
                const errorMsg = `${gatewayUrl}: ${error.message}`;
                errors.push(errorMsg);
                recordFailure(gatewayUrl, error.message);
                
                if (attempt < maxRetries - 1) {
                    console.warn(`⚠️  Gateway ${gatewayUrl} attempt ${attempt + 1} failed, retrying...`);
                }
            }
        }
        console.warn(`⚠️  Gateway ${gatewayUrl} failed, trying next gateway...`);
    }
    
    throw new Error(`All gateways failed:\n${errors.join('\n')}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    HARDCODED_GATEWAYS,
    fetchLiveGateways,
    getGatewayUrls,
    getGraphQLEndpoints,
    initializeGatewayRegistry,
    recordSuccess,
    recordFailure,
    getGatewayMetrics,
    requestWithFailover
};

