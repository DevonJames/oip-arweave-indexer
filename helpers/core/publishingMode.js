/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Publishing Mode Determination
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Determines publishing mode and signing strategy based on destination settings.
 */

const settingsManager = require('../onion-press/settingsManager');

/**
 * Check if Arweave publishing is enabled
 */
function isArweaveEnabled() {
    return settingsManager.isDestinationEnabled('arweave');
}

/**
 * Check if GUN publishing is enabled
 */
function isGunEnabled() {
    return settingsManager.isDestinationEnabled('gun');
}

/**
 * Check if local node (WordPress) publishing is enabled
 */
function isLocalNodeEnabled() {
    return settingsManager.isDestinationEnabled('thisHost');
}

/**
 * Determine if we're in local-only mode (Arweave and GUN disabled, local node enabled)
 */
function isLocalOnlyMode() {
    return !isArweaveEnabled() && !isGunEnabled() && isLocalNodeEnabled();
}

/**
 * Determine if we're in Arweave mode (Arweave enabled)
 */
function isArweaveMode() {
    return isArweaveEnabled();
}

/**
 * Get publishing mode configuration
 * @param {object} destinations - Requested destinations
 * @returns {object} Publishing mode configuration
 */
function getPublishingMode(destinations = {}) {
    const arweaveRequested = destinations.arweave !== false;
    const gunRequested = destinations.gun !== false;
    const localRequested = destinations.thisHost === true;
    
    const arweaveEnabled = isArweaveEnabled() && arweaveRequested;
    const gunEnabled = isGunEnabled() && gunRequested;
    const localEnabled = isLocalNodeEnabled() && localRequested;
    
    // Determine mode
    const localOnly = !arweaveEnabled && !gunEnabled && localEnabled;
    const arweaveMode = arweaveEnabled;
    
    return {
        localOnly,
        arweaveMode,
        arweaveEnabled,
        gunEnabled,
        localEnabled,
        needsServerSignature: arweaveMode, // Server signs when Arweave is enabled
        needsWriterSignature: false // Will be determined by publishing method
    };
}

module.exports = {
    isArweaveEnabled,
    isGunEnabled,
    isLocalNodeEnabled,
    isLocalOnlyMode,
    isArweaveMode,
    getPublishingMode
};
