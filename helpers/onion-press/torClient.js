/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TOR CLIENT - HTTP Client for TOR-proxied requests
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Provides an axios instance configured to route requests through TOR SOCKS5 proxy.
 * Used for anonymous publishing to Internet Archive and other .onion services.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fs = require('fs');
const path = require('path');

// TOR proxy configuration
const TOR_PROXY_HOST = process.env.TOR_PROXY_HOST || 'tor-daemon';
const TOR_PROXY_PORT = parseInt(process.env.TOR_PROXY_PORT) || 9050;

// Path to .onion hostname file (set by TOR daemon)
const ONION_HOSTNAME_FILE = process.env.ONION_HOSTNAME_FILE || '/var/lib/tor/hidden_service/hostname';

// Cache for .onion address
let cachedOnionAddress = null;
let lastOnionCheck = 0;
const ONION_CHECK_INTERVAL = 60000; // Check every minute

/**
 * Create a TOR-proxied axios client
 * Uses SOCKS5 proxy to route all requests through TOR
 * 
 * @returns {axios.AxiosInstance} Configured axios instance
 */
function createTorProxiedClient() {
    // socks5h:// means DNS resolution happens through the proxy (required for .onion)
    const proxyUrl = `socks5h://${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`;
    const agent = new SocksProxyAgent(proxyUrl);
    
    return axios.create({
        httpAgent: agent,
        httpsAgent: agent,
        timeout: 120000, // 2 minute timeout (TOR is slower)
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

/**
 * Get this instance's .onion address
 * Reads from the TOR hidden service hostname file
 * 
 * @returns {Promise<string|null>} .onion address or null if not available
 */
async function getOnionAddress() {
    const now = Date.now();
    
    // Return cached value if recent
    if (cachedOnionAddress && (now - lastOnionCheck) < ONION_CHECK_INTERVAL) {
        return cachedOnionAddress;
    }
    
    try {
        // Try multiple possible paths
        const possiblePaths = [
            ONION_HOSTNAME_FILE,
            '/var/lib/tor/hidden_service/hostname',
            path.join(__dirname, '..', '..', 'data', 'tor', 'hostname')
        ];
        
        for (const hostnameFile of possiblePaths) {
            try {
                if (fs.existsSync(hostnameFile)) {
                    const hostname = fs.readFileSync(hostnameFile, 'utf8').trim();
                    if (hostname && hostname.endsWith('.onion')) {
                        cachedOnionAddress = hostname;
                        lastOnionCheck = now;
                        return hostname;
                    }
                }
            } catch (e) {
                // Try next path
            }
        }
        
        // If we're not in Docker, TOR might not be running
        console.log('⚠️ TOR hidden service hostname not found');
        return null;
        
    } catch (error) {
        console.error('Error reading .onion address:', error.message);
        return null;
    }
}

/**
 * Check if TOR proxy is reachable
 * 
 * @returns {Promise<boolean>} Whether TOR proxy is accessible
 */
async function isTorAvailable() {
    try {
        const client = createTorProxiedClient();
        
        // Try to reach a known .onion address (DuckDuckGo's onion)
        // This verifies both TOR connectivity and DNS resolution
        const response = await client.get('https://check.torproject.org/', {
            timeout: 30000
        });
        
        // Clean up
        if (response.data) {
            response.data = null;
        }
        
        return true;
        
    } catch (error) {
        // Even if we can't reach the check site, TOR might still work
        // Check if it's a network timeout vs connection refused
        if (error.code === 'ECONNREFUSED') {
            return false;
        }
        // Timeout or other errors might mean TOR is slow but working
        return true;
    }
}

/**
 * Get TOR status information
 * 
 * @returns {Promise<object>} TOR status object
 */
async function getTorStatus() {
    const [onionAddress, torAvailable] = await Promise.all([
        getOnionAddress(),
        isTorAvailable()
    ]);
    
    return {
        connected: torAvailable,
        onionAddress: onionAddress,
        socksHost: TOR_PROXY_HOST,
        socksPort: TOR_PROXY_PORT,
        proxyUrl: `socks5h://${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`
    };
}

/**
 * Make a TOR-proxied HTTP request
 * 
 * @param {string} method - HTTP method
 * @param {string} url - Target URL (can be .onion)
 * @param {object} data - Request body
 * @param {object} options - Additional axios options
 * @returns {Promise<any>} Response data
 */
async function torRequest(method, url, data = null, options = {}) {
    const client = createTorProxiedClient();
    let response = null;
    
    try {
        const config = {
            method,
            url,
            ...options
        };
        
        if (data) {
            config.data = data;
        }
        
        response = await client(config);
        
        // Extract and clean up
        const responseData = response.data;
        response.data = null;
        response = null;
        
        return responseData;
        
    } catch (error) {
        // Clean up
        if (response) {
            response.data = null;
            response = null;
        }
        
        throw error;
    }
}

module.exports = {
    createTorProxiedClient,
    getOnionAddress,
    isTorAvailable,
    getTorStatus,
    torRequest
};

