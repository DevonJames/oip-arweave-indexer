/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS API CLIENT
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Detect if we're being served from /onion-press/ path or standalone
const isProxied = window.location.pathname.startsWith('/onion-press');
const API_BASE = window.location.origin;
const OIP_API = isProxied ? '/onion-press/api' : '/api';

// Auth token storage
let authToken = localStorage.getItem('onionpress_token');

/**
 * Make an API request
 */
async function apiRequest(method, endpoint, data = null) {
    const config = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    if (authToken) {
        config.headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    if (data) {
        config.body = JSON.stringify(data);
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const json = await response.json();
    
    if (!response.ok) {
        throw new Error(json.error || json.message || 'API request failed');
    }
    
    return json;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Browse API
// ═══════════════════════════════════════════════════════════════════════════════

async function getRecords(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return apiRequest('GET', `${OIP_API}/browse/records?${queryString}`);
}

async function getRecord(did) {
    return apiRequest('GET', `${OIP_API}/browse/record/${encodeURIComponent(did)}`);
}

async function getRecordTypes() {
    return apiRequest('GET', `${OIP_API}/browse/types`);
}

async function getTemplates() {
    return apiRequest('GET', `${OIP_API}/browse/templates`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Publish API
// ═══════════════════════════════════════════════════════════════════════════════

async function publishRecord(record, destinations) {
    return apiRequest('POST', `${OIP_API}/publish`, { record, destinations });
}

async function getPublishStatus(submissionId) {
    return apiRequest('GET', `${OIP_API}/publish/${submissionId}/status`);
}

async function getDestinations() {
    return apiRequest('GET', `${OIP_API}/publish/destinations`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Admin API
// ═══════════════════════════════════════════════════════════════════════════════

async function getAdminSettings() {
    return apiRequest('GET', `${OIP_API}/admin/settings`);
}

async function updateAdminSettings(settings) {
    return apiRequest('POST', `${OIP_API}/admin/settings`, settings);
}

async function resetAdminSettings() {
    return apiRequest('POST', `${OIP_API}/admin/settings/reset`);
}

async function getAdminStatus() {
    return apiRequest('GET', `${OIP_API}/admin/status`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOR API
// ═══════════════════════════════════════════════════════════════════════════════

async function getTorStatus() {
    return apiRequest('GET', `${OIP_API}/tor/status`);
}

async function testTorConnection() {
    return apiRequest('GET', `${OIP_API}/tor/test`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// WordPress API
// ═══════════════════════════════════════════════════════════════════════════════

async function getWordPressPosts(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return apiRequest('GET', `${OIP_API}/wordpress/posts?${queryString}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════════════════

async function login(email, password) {
    // Login via OIP daemon
    try {
        const response = await fetch(`${API_BASE}/api/user/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (!response.ok || !data.success) {
            throw new Error(data.error || data.message || 'Login failed');
        }
        
        if (data.token) {
            authToken = data.token;
            localStorage.setItem('onionpress_token', data.token);
            
            // Store user info
            if (data.publicKey) {
                localStorage.setItem('onionpress_user_publicKey', data.publicKey);
            }
            if (data.wordpressUserId) {
                localStorage.setItem('onionpress_user_wpId', data.wordpressUserId.toString());
            }
            
            return { 
                success: true, 
                token: data.token,
                publicKey: data.publicKey,
                wordpressUserId: data.wordpressUserId
            };
        } else {
            throw new Error('No token received from server');
        }
    } catch (error) {
        throw new Error(error.message || 'Login failed');
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('onionpress_token');
    localStorage.removeItem('onionpress_user_publicKey');
    localStorage.removeItem('onionpress_user_wpId');
    clearAdminStatus();
}

function isLoggedIn() {
    if (!authToken) return false;
    
    try {
        const payload = JSON.parse(atob(authToken));
        return payload.exp > Date.now();
    } catch {
        return false;
    }
}

function isAdmin() {
    if (!authToken) return false;
    
    try {
        // Handle JWT token format (Bearer token or base64 encoded)
        let payload;
        if (authToken.includes('.')) {
            // JWT format
            payload = JSON.parse(atob(authToken.split('.')[1]));
        } else {
            // Base64 encoded JSON
            payload = JSON.parse(atob(authToken));
        }
        return payload.isAdmin && payload.exp > Date.now();
    } catch {
        return false;
    }
}

function getAuthToken() {
    return authToken;
}

function setAuthToken(token) {
    authToken = token;
    localStorage.setItem('onionpress_token', token);
}

async function isWordPressAdmin() {
    try {
        const wpUserId = localStorage.getItem('onionpress_user_wpId');
        if (!wpUserId) {
            return false;
        }
        
        const status = await getAdminStatus();
        return status.isWordPressAdmin === true;
    } catch (error) {
        console.warn('Failed to check WordPress admin status:', error);
        return false;
    }
}

function clearAdminStatus() {
    // Clear any admin-related cached data
    localStorage.removeItem('onionpress_admin_status');
}
