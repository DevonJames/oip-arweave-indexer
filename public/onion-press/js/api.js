/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS API CLIENT
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const API_BASE = window.location.origin;
const OIP_API = '/api';

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
// Auth
// ═══════════════════════════════════════════════════════════════════════════════

async function login(email, password) {
    // Login via OIP daemon through onion-press proxy or directly
    try {
        const response = await fetch(`${API_BASE}/api/browse/records?limit=0`, {
            headers: {
                'Authorization': `Basic ${btoa(email + ':' + password)}`
            }
        });
        
        // For now, create a simple JWT-like token locally
        // In production, this would call the OIP daemon's login endpoint
        const fakeToken = btoa(JSON.stringify({
            email,
            isAdmin: email.includes('admin'),
            exp: Date.now() + 24 * 60 * 60 * 1000
        }));
        
        authToken = fakeToken;
        localStorage.setItem('onionpress_token', fakeToken);
        
        return { success: true, token: fakeToken };
    } catch (error) {
        throw new Error('Login failed');
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('onionpress_token');
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
        const payload = JSON.parse(atob(authToken));
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

