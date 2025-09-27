/**
 * URL Helper Utility
 * 
 * Provides consistent URL generation across the OIP system.
 * Handles both request-based dynamic URL generation and fallback to environment variables.
 */

/**
 * Get the base URL from a request object (preferred method)
 * @param {Object} req - Express request object
 * @returns {string} Base URL (e.g., "https://oip.fitnessally.io")
 */
function getBaseUrlFromRequest(req) {
    return `${req.protocol}://${req.get('host')}`;
}

/**
 * Get the base URL from environment variable or fallback
 * Used when request object is not available (e.g., in helper functions)
 * @returns {string} Base URL
 */
function getBaseUrlFromEnv() {
    return process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 3005}`;
}

/**
 * Get the base URL with automatic detection
 * Prefers request-based detection, falls back to environment
 * @param {Object|null} req - Express request object (optional)
 * @returns {string} Base URL
 */
function getBaseUrl(req = null) {
    if (req && req.protocol && req.get) {
        return getBaseUrlFromRequest(req);
    }
    return getBaseUrlFromEnv();
}

/**
 * Generate a media URL for the given media ID
 * @param {string} mediaId - Media file ID
 * @param {Object|null} req - Express request object (optional)
 * @returns {string} Full media URL
 */
function getMediaUrl(mediaId, req = null) {
    const baseUrl = getBaseUrl(req);
    return `${baseUrl}/api/media?id=${mediaId}`;
}

/**
 * Generate a media file URL for the given filename
 * @param {string} filename - Media filename
 * @param {Object|null} req - Express request object (optional)
 * @returns {string} Full media file URL
 */
function getMediaFileUrl(filename, req = null) {
    const baseUrl = getBaseUrl(req);
    return `${baseUrl}/api/media/${filename}`;
}

module.exports = {
    getBaseUrl,
    getBaseUrlFromRequest,
    getBaseUrlFromEnv,
    getMediaUrl,
    getMediaFileUrl
};
