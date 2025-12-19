/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS BROWSE MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// State
let currentPage = 0;
const pageSize = 20;
let totalRecords = 0;
let currentFilters = {};

// DOM Elements
const recordsContainer = document.getElementById('recordsContainer');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const typeFilter = document.getElementById('typeFilter');
const sortFilter = document.getElementById('sortFilter');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const torStatus = document.getElementById('torStatus');
const torIndicator = torStatus.querySelector('.tor-indicator');

// Tab navigation
const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Modals
const loginModal = document.getElementById('loginModal');
const recordModal = document.getElementById('recordModal');
const loginBtn = document.getElementById('loginBtn');
const closeLoginModal = document.getElementById('closeLoginModal');
const closeRecordModal = document.getElementById('closeRecordModal');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSearch();
    initPagination();
    initLogin();
    initPublish();
    checkTorStatus();
    loadRecords();
    
    // Check TOR status periodically
    setInterval(checkTorStatus, 30000);
});

/**
 * Initialize tab navigation
 */
function initNavigation() {
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // Update active button
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Show correct tab
            tabContents.forEach(content => {
                content.classList.add('hidden');
            });
            document.getElementById(`${tab}Tab`).classList.remove('hidden');
        });
    });
    
    // Show/hide admin tab based on login status
    updateAdminVisibility();
}

/**
 * Initialize search
 */
function initSearch() {
    searchBtn.addEventListener('click', () => {
        currentPage = 0;
        loadRecords();
    });
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            currentPage = 0;
            loadRecords();
        }
    });
    
    typeFilter.addEventListener('change', () => {
        currentPage = 0;
        loadRecords();
    });
    
    sortFilter.addEventListener('change', () => {
        currentPage = 0;
        loadRecords();
    });
}

/**
 * Initialize pagination
 */
function initPagination() {
    prevBtn.addEventListener('click', () => {
        if (currentPage > 0) {
            currentPage--;
            loadRecords();
        }
    });
    
    nextBtn.addEventListener('click', () => {
        if ((currentPage + 1) * pageSize < totalRecords) {
            currentPage++;
            loadRecords();
        }
    });
}

/**
 * Initialize login
 */
function initLogin() {
    loginBtn.addEventListener('click', () => {
        if (isLoggedIn()) {
            logout();
            loginBtn.textContent = 'Login';
            loginBtn.classList.remove('logged-in');
            updateAdminVisibility();
        } else {
            loginModal.classList.remove('hidden');
        }
    });
    
    closeLoginModal.addEventListener('click', () => {
        loginModal.classList.add('hidden');
    });
    
    closeRecordModal.addEventListener('click', () => {
        recordModal.classList.add('hidden');
    });
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.classList.add('hidden');
        
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        try {
            await login(email, password);
            loginModal.classList.add('hidden');
            loginBtn.textContent = 'Logout';
            loginBtn.classList.add('logged-in');
            updateAdminVisibility();
        } catch (error) {
            loginError.textContent = error.message;
            loginError.classList.remove('hidden');
        }
    });
    
    // Check if already logged in
    if (isLoggedIn()) {
        loginBtn.textContent = 'Logout';
        loginBtn.classList.add('logged-in');
    }
}

/**
 * Initialize publish tab
 */
function initPublish() {
    const publishBtn = document.getElementById('publishBtn');
    const publishStatus = document.getElementById('publishStatus');
    
    publishBtn.addEventListener('click', async () => {
        const title = document.getElementById('recordTitle').value;
        const description = document.getElementById('recordDescription').value;
        const content = document.getElementById('recordContent').value;
        const tags = document.getElementById('recordTags').value;
        const recordType = document.getElementById('recordType').value;
        
        if (!title) {
            showPublishStatus('error', 'Title is required');
            return;
        }
        
        const record = {
            basic: {
                name: title,
                description: description || '',
                date: Math.floor(Date.now() / 1000),
                tagItems: tags.split(',').map(t => t.trim()).filter(t => t)
            }
        };
        
        // Add record type specific fields
        if (recordType === 'post') {
            record.post = {
                articleText: content || ''
            };
        }
        
        const destinations = {
            arweave: document.getElementById('destArweave').checked,
            gun: document.getElementById('destGun').checked,
            internetArchive: document.getElementById('destIA').checked
        };
        
        try {
            showPublishStatus('processing', 'Publishing record...');
            
            const result = await publishRecord(record, destinations);
            
            showPublishStatus('success', `Published! Submission ID: ${result.submissionId}`);
            
            // Clear form
            document.getElementById('recordTitle').value = '';
            document.getElementById('recordDescription').value = '';
            document.getElementById('recordContent').value = '';
            document.getElementById('recordTags').value = '';
            
        } catch (error) {
            showPublishStatus('error', `Failed: ${error.message}`);
        }
    });
}

function showPublishStatus(type, message) {
    const publishStatus = document.getElementById('publishStatus');
    publishStatus.className = `publish-status ${type}`;
    publishStatus.textContent = message;
    publishStatus.classList.remove('hidden');
}

/**
 * Update admin tab visibility
 */
function updateAdminVisibility() {
    const adminBtn = document.querySelector('.nav-btn[data-tab="admin"]');
    if (isAdmin()) {
        adminBtn.classList.remove('hidden');
        adminBtn.classList.add('visible');
    } else {
        adminBtn.classList.add('hidden');
        adminBtn.classList.remove('visible');
    }
}

/**
 * Load records
 */
async function loadRecords() {
    recordsContainer.innerHTML = '<div class="loading">Loading records...</div>';
    
    try {
        const params = {
            limit: pageSize,
            offset: currentPage * pageSize,
            sortBy: sortFilter.value
        };
        
        if (searchInput.value) {
            params.search = searchInput.value;
        }
        
        if (typeFilter.value) {
            params.recordType = typeFilter.value;
        }
        
        const data = await getRecords(params);
        totalRecords = data.total || data.records?.length || 0;
        
        renderRecords(data.records || []);
        updatePagination();
        
    } catch (error) {
        recordsContainer.innerHTML = `<div class="loading">Error loading records: ${error.message}</div>`;
    }
}

/**
 * Render records
 */
function renderRecords(records) {
    if (records.length === 0) {
        recordsContainer.innerHTML = '<div class="loading">No records found</div>';
        return;
    }
    
    recordsContainer.innerHTML = records.map(record => renderRecordCard(record)).join('');
    
    // Add click handlers
    recordsContainer.querySelectorAll('.record-card').forEach(card => {
        card.addEventListener('click', () => {
            const did = card.dataset.did;
            showRecordDetail(did);
        });
    });
}

/**
 * Render a single record card
 */
function renderRecordCard(record) {
    const data = record.data || {};
    const oip = record.oip || {};
    const sources = record._publishingSources || [];
    
    const type = oip.recordType || 'basic';
    const icon = getTypeIcon(type);
    const title = data.name || data.title || 'Untitled';
    const description = data.description || data.articleText?.substring(0, 200) || '';
    const tags = data.tagItems || [];
    const date = data.date ? new Date(data.date * 1000).toLocaleDateString() : '';
    const did = oip.did || oip.didTx || '';
    
    return `
        <div class="record-card" data-did="${did}">
            <div class="record-header">
                <span class="record-type-icon">${icon}</span>
                <h3 class="record-title">${escapeHtml(title)}</h3>
            </div>
            <p class="record-description">${escapeHtml(description)}</p>
            <div class="record-meta">
                <span>📅 ${date}</span>
                <span>📝 ${type}</span>
            </div>
            ${tags.length > 0 ? `
                <div class="record-tags">
                    ${tags.slice(0, 5).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}
            ${sources.length > 0 ? `
                <div class="record-sources">
                    ${sources.map(s => `<span class="source-badge ${s}">${s}</span>`).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Get icon for record type
 */
function getTypeIcon(type) {
    const icons = {
        post: '📰',
        image: '🖼️',
        video: '🎬',
        audio: '🎵',
        recipe: '🍳',
        exercise: '🏋️',
        basic: '📄',
        creator: '👤',
        organization: '🏢',
        template: '📋'
    };
    return icons[type] || '📄';
}

/**
 * Show record detail modal
 */
async function showRecordDetail(did) {
    const detailContainer = document.getElementById('recordDetail');
    detailContainer.innerHTML = '<div class="loading">Loading...</div>';
    recordModal.classList.remove('hidden');
    
    try {
        const record = await getRecord(did);
        detailContainer.innerHTML = renderRecordDetail(record);
    } catch (error) {
        detailContainer.innerHTML = `<div class="error-msg">Error: ${error.message}</div>`;
    }
}

/**
 * Render record detail
 */
function renderRecordDetail(record) {
    const data = record.data || {};
    const oip = record.oip || {};
    const sources = record._publishingSources || [];
    
    return `
        <h2>${escapeHtml(data.name || 'Untitled')}</h2>
        <div class="record-meta" style="margin-bottom: 1rem;">
            <span>Type: ${oip.recordType || 'unknown'}</span>
            <span>Date: ${data.date ? new Date(data.date * 1000).toLocaleString() : 'N/A'}</span>
        </div>
        ${data.description ? `<p style="margin-bottom: 1rem;">${escapeHtml(data.description)}</p>` : ''}
        ${data.articleText ? `<div style="margin-bottom: 1rem; white-space: pre-wrap;">${escapeHtml(data.articleText)}</div>` : ''}
        ${sources.length > 0 ? `
            <div class="record-sources" style="margin-bottom: 1rem;">
                ${sources.map(s => `<span class="source-badge ${s}">${s}</span>`).join('')}
            </div>
        ` : ''}
        <details style="margin-top: 1rem;">
            <summary style="cursor: pointer; color: var(--text-muted);">Raw Data</summary>
            <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; overflow: auto; font-size: 0.8rem; margin-top: 0.5rem;">${escapeHtml(JSON.stringify(record, null, 2))}</pre>
        </details>
    `;
}

/**
 * Update pagination controls
 */
function updatePagination() {
    const totalPages = Math.ceil(totalRecords / pageSize);
    pageInfo.textContent = `Page ${currentPage + 1} of ${totalPages || 1}`;
    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = (currentPage + 1) * pageSize >= totalRecords;
}

/**
 * Check TOR status
 */
async function checkTorStatus() {
    try {
        const status = await getTorStatus();
        
        if (status.connected) {
            torIndicator.classList.add('connected');
            torIndicator.classList.remove('disconnected');
            torStatus.title = `TOR Connected: ${status.onionAddress || 'Hidden service'}`;
        } else {
            torIndicator.classList.remove('connected');
            torIndicator.classList.add('disconnected');
            torStatus.title = 'TOR Disconnected';
        }
    } catch (error) {
        torIndicator.classList.remove('connected');
        torIndicator.classList.add('disconnected');
        torStatus.title = 'TOR Status Unknown';
    }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

