/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SETTINGS MANAGER - Onion Press Server Settings
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Manages runtime settings for the Onion Press Server:
 *   - Publishing destinations (Arweave, GUN, Internet Archive)
 *   - GUN sync configuration
 *   - TOR status caching
 * 
 * Settings can be updated via the admin API and are persisted to a JSON file.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Settings file path
const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(__dirname, '..', '..', 'data', 'settings', 'onion-press-settings.json');

// Default settings
const DEFAULT_SETTINGS = {
    // Publishing destinations
    publishToArweave: process.env.PUBLISH_TO_ARWEAVE !== 'false',
    publishToGun: process.env.PUBLISH_TO_GUN !== 'false',
    publishToInternetArchive: process.env.PUBLISH_TO_INTERNETARCHIVE === 'true',
    
    // GUN sync configuration
    gunExternalPeers: process.env.GUN_EXTERNAL_PEERS || '',
    gunSyncInterval: parseInt(process.env.GUN_SYNC_INTERVAL) || 30000,
    gunSyncTrustedNodes: process.env.GUN_SYNC_TRUSTED_NODES || '',
    
    // Internet Archive configuration
    iaOrganizationHandle: process.env.IA_ORGANIZATION_HANDLE || 'internetarchive',
    
    // TOR configuration (integrated - runs in same container)
    torProxyHost: process.env.TOR_PROXY_HOST || '127.0.0.1',
    torProxyPort: parseInt(process.env.TOR_PROXY_PORT) || 9050
};

// Current settings (in-memory)
let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Load settings from file
 */
function loadSettings() {
    try {
        // Ensure settings directory exists
        const settingsDir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true });
        }
        
        if (fs.existsSync(SETTINGS_FILE)) {
            const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const savedSettings = JSON.parse(fileContent);
            
            // Merge saved settings with defaults (defaults fill in any missing keys)
            currentSettings = { ...DEFAULT_SETTINGS, ...savedSettings };
            console.log('✅ Settings loaded from file');
        } else {
            // Initialize with defaults
            currentSettings = { ...DEFAULT_SETTINGS };
            saveSettings();
            console.log('✅ Settings initialized with defaults');
        }
    } catch (error) {
        console.error('⚠️ Error loading settings, using defaults:', error.message);
        currentSettings = { ...DEFAULT_SETTINGS };
    }
}

/**
 * Save settings to file
 */
function saveSettings() {
    try {
        const settingsDir = path.dirname(SETTINGS_FILE);
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true });
        }
        
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2));
        console.log('✅ Settings saved to file');
        return true;
    } catch (error) {
        console.error('⚠️ Error saving settings:', error.message);
        return false;
    }
}

/**
 * Get a single setting value
 * @param {string} key - Setting key
 * @returns {any} Setting value
 */
function getSetting(key) {
    return currentSettings[key];
}

/**
 * Get all settings
 * @returns {object} All settings
 */
function getAllSettings() {
    return { ...currentSettings };
}

/**
 * Update settings
 * @param {object} updates - Object with setting updates
 * @returns {object} Updated settings
 */
function updateSettings(updates) {
    // Only allow updating specific keys
    const allowedKeys = [
        'publishToArweave',
        'publishToGun',
        'publishToInternetArchive',
        'gunExternalPeers',
        'gunSyncInterval',
        'gunSyncTrustedNodes',
        'iaOrganizationHandle'
    ];
    
    for (const key of allowedKeys) {
        if (updates[key] !== undefined) {
            // Type coercion for specific fields
            if (key === 'gunSyncInterval') {
                currentSettings[key] = parseInt(updates[key]) || 30000;
            } else if (['publishToArweave', 'publishToGun', 'publishToInternetArchive'].includes(key)) {
                currentSettings[key] = Boolean(updates[key]);
            } else {
                currentSettings[key] = updates[key];
            }
        }
    }
    
    // Save to file
    saveSettings();
    
    return getAllSettings();
}

/**
 * Reset settings to defaults
 * @returns {object} Default settings
 */
function resetSettings() {
    currentSettings = { ...DEFAULT_SETTINGS };
    saveSettings();
    return getAllSettings();
}

/**
 * Check if a publishing destination is enabled
 * @param {string} destination - 'arweave', 'gun', or 'internetArchive'
 * @returns {boolean} Whether destination is enabled
 */
function isDestinationEnabled(destination) {
    switch (destination.toLowerCase()) {
        case 'arweave':
            return currentSettings.publishToArweave;
        case 'gun':
            return currentSettings.publishToGun;
        case 'internetarchive':
        case 'ia':
            return currentSettings.publishToInternetArchive;
        default:
            return false;
    }
}

/**
 * Get enabled destinations
 * @returns {string[]} List of enabled destination names
 */
function getEnabledDestinations() {
    const destinations = [];
    if (currentSettings.publishToArweave) destinations.push('arweave');
    if (currentSettings.publishToGun) destinations.push('gun');
    if (currentSettings.publishToInternetArchive) destinations.push('internetArchive');
    return destinations;
}

// Load settings on module initialization
loadSettings();

module.exports = {
    getSetting,
    getAllSettings,
    updateSettings,
    resetSettings,
    isDestinationEnabled,
    getEnabledDestinations,
    loadSettings,
    saveSettings
};

