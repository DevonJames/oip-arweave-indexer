/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS BROWSE MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// State
let currentPage = 0;
const pageSize = 20;
let totalRecords = 0;
let currentFilters = {
    author: null  // Track author filter separately from search
};

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
const authorFilterIndicator = document.getElementById('authorFilterIndicator');
const authorFilterValue = document.getElementById('authorFilterValue');
const clearAuthorFilter = document.getElementById('clearAuthorFilter');

// Tab navigation
const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Modals
const loginModal = document.getElementById('loginModal');
const registerModal = document.getElementById('registerModal');
const recordModal = document.getElementById('recordModal');
const loginBtn = document.getElementById('loginBtn');
const closeLoginModal = document.getElementById('closeLoginModal');
const closeRegisterModal = document.getElementById('closeRegisterModal');
const closeRecordModal = document.getElementById('closeRecordModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');
const registerSuccess = document.getElementById('registerSuccess');
const showRegisterModal = document.getElementById('showRegisterModal');
const showLoginModal = document.getElementById('showLoginModal');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Type filter is commented out in HTML, so typeFilter will be null
    // We'll default to 'post' in loadRecords() instead
    
    initNavigation();
    initSearch();
    initPagination();
    initLogin();
    initPublish();
    checkTorStatus();
    loadRecords();
    
    // Check admin status and update UI
    await updateAdminUI();
    
    // Check TOR status periodically
    setInterval(checkTorStatus, 30000);
});

/**
 * Update UI based on admin status
 */
async function updateAdminUI() {
    try {
        // Check if user is logged in first
        // Since scripts are loaded synchronously, isLoggedIn should be available globally from api.js
        if (typeof isLoggedIn !== 'function') {
            console.warn('⚠️ isLoggedIn function not available, hiding admin UI');
            const settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn) {
                settingsBtn.classList.add('hidden');
            }
            return;
        }
        
        if (!isLoggedIn()) {
            console.log('👤 User not logged in, hiding admin UI');
            const settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn) {
                settingsBtn.classList.add('hidden');
            }
            return;
        }
        
        console.log('✅ User is logged in, checking admin status...');
        
        // getAdminStatus is available globally from api.js (loaded before browse.js)
        if (typeof getAdminStatus !== 'function') {
            console.error('❌ getAdminStatus function not available');
            const settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn) {
                settingsBtn.classList.add('hidden');
            }
            return;
        }
        
        const status = await getAdminStatus();
        console.log('📊 Admin status response:', status);
        
        // Check both WordPress admin and email-based admin (ONIONPRESS_ADMIN)
        const wpAdmin = status.isWordPressAdmin === true;
        const isEmailAdmin = status.isOnionPressAdmin === true;
        const isAdmin = wpAdmin || isEmailAdmin;
        
        console.log(`🔐 Admin check results: WordPress=${wpAdmin}, Email=${isEmailAdmin}, Total=${isAdmin}`);
        
        // Show/hide settings gear icon
        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            if (isAdmin) {
                console.log('✅ User is admin (WordPress or email match), showing settings button');
                settingsBtn.classList.remove('hidden');
                settingsBtn.classList.add('visible');
                // Ensure admin-only class is present for styling
                if (!settingsBtn.classList.contains('admin-only')) {
                    settingsBtn.classList.add('admin-only');
                }
            } else {
                console.log('❌ User is not admin, hiding settings button');
                settingsBtn.classList.add('hidden');
                settingsBtn.classList.remove('visible');
            }
        } else {
            console.warn('⚠️ Settings button element (#settingsBtn) not found in DOM');
        }
    } catch (error) {
        console.error('❌ Failed to update admin UI:', error);
        console.error('Error details:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        // Hide admin UI on error
        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            settingsBtn.classList.add('hidden');
        }
    }
}

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
        // Clear author filter when doing text search
        currentFilters.author = null;
        currentPage = 0;
        loadRecords();
    });
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            // Clear author filter when doing text search
            currentFilters.author = null;
            currentPage = 0;
            loadRecords();
        }
    });
    
    // Clear author filter when search input changes
    searchInput.addEventListener('input', () => {
        if (currentFilters.author && searchInput.value) {
            currentFilters.author = null;
        }
    });
    
    // Type filter is commented out in HTML, so check if it exists
    if (typeFilter) {
        typeFilter.addEventListener('change', () => {
            currentPage = 0;
            loadRecords();
        });
    }
    
    sortFilter.addEventListener('change', () => {
        currentPage = 0;
        loadRecords();
    });
    
    // Author filter clear button
    if (clearAuthorFilter) {
        clearAuthorFilter.addEventListener('click', clearAuthorFilterHandler);
    }
    
    // Initialize filter indicator
    updateAuthorFilterIndicator();
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
            
            // Update Account/WordPress button
            const accountWordPressBtnText = document.getElementById('accountWordPressBtnText');
            if (accountWordPressBtnText) {
                accountWordPressBtnText.textContent = 'Login to Access WordPress →';
            }
        } else {
            // Check if user wants to open WordPress
            const currentTab = document.querySelector('.nav-btn.active')?.dataset.tab;
            if (currentTab === 'publish') {
                // User is on publish tab, they probably want WordPress
                sessionStorage.setItem('openingWordPress', 'true');
            }
            loginModal.classList.remove('hidden');
        }
    });
    
    closeLoginModal.addEventListener('click', () => {
        loginModal.classList.add('hidden');
    });
    
    closeRegisterModal.addEventListener('click', () => {
        registerModal.classList.add('hidden');
    });
    
    closeRecordModal.addEventListener('click', () => {
        recordModal.classList.add('hidden');
    });
    
    // Handle author link clicks (event delegation)
    if (recordModal) {
        recordModal.addEventListener('click', (e) => {
            const authorLink = e.target.closest('.author-link');
            if (authorLink) {
                e.preventDefault();
                const author = authorLink.getAttribute('data-filter-author');
                if (author) {
                    filterByAuthor(author);
                }
            }
        });
    }
    
    // Link between Login and Register modals
    if (showRegisterModal) {
        showRegisterModal.addEventListener('click', (e) => {
            e.preventDefault();
            loginModal.classList.add('hidden');
            registerModal.classList.remove('hidden');
        });
    }
    
    if (showLoginModal) {
        showLoginModal.addEventListener('click', (e) => {
            e.preventDefault();
            registerModal.classList.add('hidden');
            loginModal.classList.remove('hidden');
        });
    }
    
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.classList.add('hidden');
        
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        try {
            const result = await login(email, password);
            loginModal.classList.add('hidden');
            loginBtn.textContent = 'Logout';
            loginBtn.classList.add('logged-in');
            updateAdminVisibility();
            
            // Update Account/WordPress button
            const accountWordPressBtnText = document.getElementById('accountWordPressBtnText');
            if (accountWordPressBtnText) {
                accountWordPressBtnText.textContent = 'Open WordPress →';
            }
            
            // Update admin UI
            await updateAdminUI();
            
            // Check if user was trying to access WordPress
            const wasOpeningWordPress = sessionStorage.getItem('openingWordPress') === 'true';
            if (wasOpeningWordPress) {
                sessionStorage.removeItem('openingWordPress');
                // Open WordPress in new tab
                window.open('/wordpress/wp-admin/', '_blank');
            }
        } catch (error) {
            loginError.textContent = error.message;
            loginError.classList.remove('hidden');
        }
    });
    
    // Register form handler
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            registerError.classList.add('hidden');
            registerSuccess.classList.add('hidden');
            
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            
            try {
                const result = await register(email, password);
                registerSuccess.textContent = 'Registration successful! You can now login.';
                registerSuccess.classList.remove('hidden');
                
                // Clear form
                registerForm.reset();
                
                // After 2 seconds, switch to login modal
                setTimeout(() => {
                    registerModal.classList.add('hidden');
                    loginModal.classList.remove('hidden');
                    // Pre-fill email in login form
                    document.getElementById('loginEmail').value = email;
                }, 2000);
            } catch (error) {
                registerError.textContent = error.message;
                registerError.classList.remove('hidden');
            }
        });
    }
    
    // Check if already logged in
    if (isLoggedIn()) {
        loginBtn.textContent = 'Logout';
        loginBtn.classList.add('logged-in');
        
        // Update Account/WordPress button
        const accountWordPressBtnText = document.getElementById('accountWordPressBtnText');
        if (accountWordPressBtnText) {
            accountWordPressBtnText.textContent = 'Open WordPress →';
        }
    }
}

/**
 * Handle Account/WordPress button click
 */
// Removed - Account/WordPress button now links directly to /publish?method=account

/**
 * Initialize publish tab
 */
function initPublish() {
    const publishBtn = document.getElementById('publishBtn');
    const publishStatus = document.getElementById('publishStatus');
    
    // Update Account/WordPress button text based on login status
    const accountWordPressBtn = document.getElementById('accountWordPressBtn');
    const accountWordPressBtnText = document.getElementById('accountWordPressBtnText');
    if (accountWordPressBtnText) {
        if (isLoggedIn()) {
            accountWordPressBtnText.textContent = 'Open WordPress →';
        } else {
            accountWordPressBtnText.textContent = 'Login to Access WordPress →';
        }
    }
    
    // Publish tab no longer has a publish button (removed in favor of WordPress)
    // This function is kept for backwards compatibility but does nothing
    if (!publishBtn) {
        return;
    }
    
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
        // Get destination settings (will use defaults from .env if not set)
        const destinations = window.onionPressSettings?.getDestinations() || {
            arweave: false,
            gun: false,
            thisHost: true
        };
        
        const allRecords = [];
        
        // Load from Arweave/GUN if enabled
        if (destinations.arweave || destinations.gun) {
            const params = {
                limit: pageSize,
                offset: currentPage * pageSize,
                sortBy: sortFilter.value
            };
            
            if (searchInput.value) {
                params.search = searchInput.value;
            }
            
            // Type filter is commented out, default to 'post'
            const recordType = typeFilter?.value || 'post';
            if (recordType) {
                params.recordType = recordType;
            }
            
            const data = await getRecords(params);
            allRecords.push(...(data.records || []));
            totalRecords = data.total || data.records?.length || 0;
        }
        
        // Load from WordPress if "thisHost" is enabled
        if (destinations.thisHost) {
            try {
                console.log('Loading WordPress posts...');
                // Type filter is commented out, default to 'post'
                const recordType = typeFilter?.value || 'post';
                const wpParams = {
                    limit: pageSize,
                    offset: currentPage * pageSize,
                    type: recordType
                };
                // Add text search if present
                if (searchInput.value) {
                    wpParams.search = searchInput.value;
                }
                // Add author filter if present (separate from text search)
                if (currentFilters.author) {
                    wpParams.author = currentFilters.author;
                }
                const wpRecords = await getWordPressPosts(wpParams);
                console.log('WordPress posts loaded:', wpRecords.length);
                allRecords.push(...wpRecords);
                // Update total if we got WordPress posts
                if (wpRecords.length > 0) {
                    totalRecords = Math.max(totalRecords, allRecords.length);
                }
            } catch (error) {
                console.error('Failed to load WordPress posts:', error);
            }
        } else {
            console.log('WordPress posts disabled (thisHost not enabled)');
        }
        
        // Remove duplicates by DID or post ID
        const uniqueRecords = deduplicateRecords(allRecords);
        
        // Sort records
        sortRecords(uniqueRecords, sortFilter.value);
        
        // Limit to page size
        const paginatedRecords = uniqueRecords.slice(
            currentPage * pageSize,
            (currentPage + 1) * pageSize
        );
        
        totalRecords = uniqueRecords.length;
        renderRecords(paginatedRecords);
        updatePagination();
        
    } catch (error) {
        recordsContainer.innerHTML = `<div class="loading">Error loading records: ${error.message}</div>`;
    }
}

/**
 * Deduplicate records by DID or post ID
 */
function deduplicateRecords(records) {
    const seen = new Set();
    return records.filter(record => {
        const id = record.oip?.did || record.oip?.didTx || record.wordpress?.postId || record.id;
        if (seen.has(id)) {
            return false;
        }
        seen.add(id);
        return true;
    });
}

/**
 * Sort records
 */
function sortRecords(records, sortBy) {
    const [field, direction] = sortBy.split(':');
    const asc = direction === 'asc';
    
    records.sort((a, b) => {
        let aVal, bVal;
        
        if (field === 'date') {
            aVal = a.oip?.indexedAt || a.wordpress?.postDate || 0;
            bVal = b.oip?.indexedAt || b.wordpress?.postDate || 0;
        } else if (field === 'name') {
            aVal = (a.data?.basic?.name || a.wordpress?.title || '').toLowerCase();
            bVal = (b.data?.basic?.name || b.wordpress?.title || '').toLowerCase();
        } else {
            return 0;
        }
        
        if (aVal < bVal) return asc ? -1 : 1;
        if (aVal > bVal) return asc ? 1 : -1;
        return 0;
    });
}

/**
 * Render records
 */
function renderRecords(records) {
    if (records.length === 0) {
        let message = 'No records found';
        if (currentFilters.author) {
            message = `No records found by ${currentFilters.author}`;
        }
        recordsContainer.innerHTML = `<div class="loading">${message}</div>`;
        return;
    }
    
    recordsContainer.innerHTML = records.map(record => renderRecordCard(record)).join('');
    
    // Add click handlers
    recordsContainer.querySelectorAll('.record-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't trigger if clicking on a link
            if (e.target.tagName === 'A') {
                return;
            }
            
            // Check if this is a WordPress post
            const wpId = card.dataset.wpId;
            const recordId = card.dataset.recordId;
            const did = card.dataset.did;
            
            if (wpId || (recordId && recordId.startsWith('wp-'))) {
                // WordPress post - fetch from WordPress API
                showWordPressRecordDetail(wpId || recordId.replace('wp-', ''));
            } else if (did) {
                // OIP record - fetch from OIP API
                showRecordDetail(did);
            }
        });
    });
}

/**
 * Detect publishing sources from record metadata
 */
function detectSources(record) {
    const sources = [];
    const oip = record.oip || {};
    const did = oip.did || oip.didTx || '';
    
    // Check DID format for source
    if (did.includes('did:arweave:') || oip.inArweaveBlock) {
        sources.push('arweave');
    }
    if (did.includes('did:gun:') || oip.gunSoul) {
        sources.push('gun');
    }
    // Check for Internet Archive indicator
    if (oip.viaInternetArchive || oip.viaTor) {
        sources.push('tor');
    }
    
    return sources;
}

/**
 * Render a single record card
 */
function renderRecordCard(record) {
    // Handle WordPress posts differently
    if (record.wordpress) {
        return renderWordPressCard(record);
    }
    
    const data = record.data || {};
    const oip = record.oip || {};
    const sources = record._publishingSources || detectSources(record);
    
    // OIP records nest fields under data.basic and data.[recordType]
    const basic = data.basic || {};
    const type = oip.recordType || 'basic';
    const typeData = data[type] || {};
    
    const icon = getTypeIcon(type);
    
    // Title: prefer basic.name, fall back to type-specific fields
    const title = basic.name || typeData.title || typeData.name || data.name || 'Untitled';
    
    // Description: prefer basic.description, fall back to type-specific
    const description = basic.description || typeData.description || 
        (typeData.articleText?.data?.text?.webUrl ? '' : typeData.articleText?.substring?.(0, 200)) || '';
    
    // Tags from basic template
    const tags = basic.tagItems || data.tagItems || [];
    
    // Date: use basic.date (unix timestamp) or dateReadable
    let date = '';
    if (basic.date) {
        date = new Date(basic.date * 1000).toLocaleDateString();
    } else if (basic.dateReadable) {
        date = basic.dateReadable;
    } else if (oip.indexedAt) {
        date = new Date(oip.indexedAt).toLocaleDateString();
    }
    
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
            ${author ? `<div class="record-author" style="margin-top: 0.5rem; color: var(--text-muted); font-size: 0.9em;">By: ${renderAuthorLink(author)}</div>` : ''}
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
 * Render WordPress post card
 */
function renderWordPressCard(record) {
    const wp = record.wordpress || {};
    const title = wp.title || 'Untitled';
    // Render HTML instead of escaping it (excerpt may contain HTML)
    const excerpt = wp.excerpt || wp.content?.substring(0, 200) || '';
    const date = wp.postDate ? new Date(wp.postDate).toLocaleDateString() : '';
    const permalink = wp.permalink || '';
    const tags = wp.tags || [];
    const author = wp.author || '';
    
    return `
        <div class="record-card" data-wp-id="${wp.postId || ''}" data-record-id="${record.id || ''}">
            <div class="record-header">
                <span class="record-type-icon">📝</span>
                <h3 class="record-title">${escapeHtml(title)}</h3>
            </div>
            <div class="record-description">${excerpt}</div>
            <div class="record-meta">
                <span>📅 ${date}</span>
                <span class="source-badge wordpress">WordPress</span>
            </div>
            ${author ? `<div class="record-author" style="margin-top: 0.5rem; color: var(--text-muted); font-size: 0.9em;">By: ${renderAuthorLink(author)}</div>` : ''}
            ${tags.length > 0 ? `
                <div class="record-tags">
                    ${tags.slice(0, 5).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
            ` : ''}
            ${/* View Post link - commented out per user request
            ${permalink ? `
                <div class="record-actions">
                    <a href="${escapeHtml(permalink)}" target="_blank" class="record-link">View Post →</a>
                </div>
            ` : ''}
            */ ''}
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
 * Show WordPress post detail modal
 */
async function showWordPressRecordDetail(postId) {
    const detailContainer = document.getElementById('recordDetail');
    detailContainer.innerHTML = '<div class="loading">Loading...</div>';
    recordModal.classList.remove('hidden');
    
    try {
        // Fetch single WordPress post by ID
        const record = await getRecord(`wp-${postId}`);
        detailContainer.innerHTML = renderWordPressRecordDetail(record);
    } catch (error) {
        detailContainer.innerHTML = `<div class="error-msg">Error: ${error.message}</div>`;
    }
}

/**
 * Render markdown content safely
 */
function renderMarkdown(markdown) {
    if (!markdown) return '';
    try {
        // Check if marked is available
        if (typeof marked !== 'undefined') {
            // Configure marked for safe rendering
            marked.setOptions({
                breaks: true,
                gfm: true,
                sanitize: false,
                headerIds: false
            });
            return marked.parse(markdown);
        } else {
            // Fallback to plain text if marked not loaded
            return escapeHtml(markdown);
        }
    } catch (error) {
        console.warn('Markdown rendering error:', error);
        return escapeHtml(markdown);
    }
}

/**
 * Check if author should be clickable (only emails and DIDs)
 */
function isAuthorClickable(author) {
    if (!author) return false;
    const authorTrimmed = author.trim();
    
    // Check if it's a DID (starts with "did:arweave:")
    if (authorTrimmed.startsWith('did:arweave:')) {
        return true;
    }
    
    // Check if it's an email address (contains @ and looks like an email)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(authorTrimmed)) {
        return true;
    }
    
    // Everything else (custom bylines from anonymous publishing) should not be clickable
    return false;
}

/**
 * Filter records by author/DID
 */
function filterByAuthor(author) {
    if (!author) return;
    
    // Close modal first
    if (recordModal) {
        recordModal.classList.add('hidden');
    }
    
    // Store author filter in a custom way (not using search input)
    // We'll pass it as a query parameter when loading records
    currentFilters.author = author;
    
    // Clear search input (author filtering is separate from text search)
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Update filter indicator
    updateAuthorFilterIndicator();
    
    // Trigger reload with author filter
    currentPage = 0;
    loadRecords();
}

/**
 * Update author filter indicator visibility and content
 */
function updateAuthorFilterIndicator() {
    if (!authorFilterIndicator || !authorFilterValue) return;
    
    if (currentFilters.author) {
        authorFilterValue.textContent = currentFilters.author;
        authorFilterIndicator.classList.remove('hidden');
    } else {
        authorFilterIndicator.classList.add('hidden');
    }
}

/**
 * Clear author filter
 */
function clearAuthorFilterHandler() {
    currentFilters.author = null;
    updateAuthorFilterIndicator();
    currentPage = 0;
    loadRecords();
}

// Expose filterByAuthor globally for onclick handlers
window.onionPressBrowse = {
    filterByAuthor: filterByAuthor
};

/**
 * Render author as clickable link if appropriate
 */
function renderAuthorLink(author) {
    if (!author) return '';
    
    // Check if author should be clickable
    if (!isAuthorClickable(author)) {
        return escapeHtml(author);
    }
    
    // Make it clickable - use data attribute and event delegation for better security
    const isDid = author.startsWith('did:arweave:');
    const linkClass = isDid ? 'author-link did-link' : 'author-link account-link';
    const escapedAuthor = escapeHtml(author);
    // HTML encode the author for the data attribute
    const dataAuthor = escapedAuthor.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    // Use data attribute instead of inline onclick for better security
    // Make it clearly visible as a link with purple color and underline
    return `<a href="#" data-filter-author="${dataAuthor}" class="${linkClass}" style="color: var(--accent-primary); text-decoration: underline; cursor: pointer; font-weight: 500;">${escapedAuthor}</a>`;
}

/**
 * Render WordPress post detail
 */
function renderWordPressRecordDetail(record) {
    const wp = record.wordpress || {};
    const title = wp.title || 'Untitled';
    const content = wp.content || '';
    const excerpt = wp.excerpt || '';
    const date = wp.postDate ? new Date(wp.postDate).toLocaleString() : '';
    const permalink = wp.permalink || '';
    const tags = wp.tags || [];
    const author = wp.author || '';
    
    // View on WordPress link - commented out per user request
    // ${permalink ? `<p style="margin-bottom: 1rem;"><a href="${escapeHtml(permalink)}" target="_blank" rel="noopener" style="color: var(--accent-purple);">🔗 View on WordPress</a></p>` : ''}
    
    return `
        <h2>${escapeHtml(title)}</h2>
        <div class="record-meta" style="margin-bottom: 1rem;">
            <span>Type: Post</span>
            <span>Date: ${date}</span>
            <span class="source-badge wordpress">WordPress</span>
        </div>
        ${author ? `<p style="margin-bottom: 0.5rem; color: var(--text-muted);">By: ${renderAuthorLink(author)}</p>` : ''}
        ${excerpt ? `<div style="margin-bottom: 1rem; color: var(--text-muted); font-style: italic;">${renderMarkdown(excerpt)}</div>` : ''}
        ${content ? `<div class="markdown-content" style="margin-bottom: 1rem;">${renderMarkdown(content)}</div>` : ''}
        ${tags.length > 0 ? `
            <div class="record-tags" style="margin-bottom: 1rem;">
                ${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
        ` : ''}
        <details style="margin-top: 1rem;">
            <summary style="cursor: pointer; color: var(--text-muted);">Raw Data</summary>
            <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 8px; overflow: auto; font-size: 0.8rem; margin-top: 0.5rem;">${escapeHtml(JSON.stringify(record, null, 2))}</pre>
        </details>
    `;
}

/**
 * Render record detail
 */
function renderRecordDetail(record) {
    const data = record.data || {};
    const oip = record.oip || {};
    const sources = record._publishingSources || detectSources(record);
    
    // OIP records nest fields under data.basic and data.[recordType]
    const basic = data.basic || {};
    const type = oip.recordType || 'basic';
    const typeData = data[type] || {};
    
    // Extract fields from proper locations
    const title = basic.name || typeData.title || typeData.name || 'Untitled';
    const description = basic.description || typeData.description || '';
    const tags = basic.tagItems || [];
    
    // Date handling
    let dateStr = 'N/A';
    if (basic.date) {
        dateStr = new Date(basic.date * 1000).toLocaleString();
    } else if (basic.dateReadable) {
        dateStr = basic.dateReadable;
    } else if (oip.indexedAt) {
        dateStr = new Date(oip.indexedAt).toLocaleString();
    }
    
    // Article text for posts - handle nested structure
    let articleContent = '';
    if (typeData.articleText) {
        if (typeof typeData.articleText === 'string') {
            articleContent = typeData.articleText;
        } else if (typeData.articleText.data?.text?.webUrl) {
            // Article text is stored as a reference - show link
            articleContent = `[Article content stored at: ${typeData.articleText.data.text.webUrl}]`;
        }
    }
    
    // Post-specific fields
    const webUrl = typeData.webUrl || '';
    const author = typeData.bylineWriter || basic.author || '';
    
    return `
        <h2>${escapeHtml(title)}</h2>
        <div class="record-meta" style="margin-bottom: 1rem;">
            <span>Type: ${type}</span>
            <span>Date: ${dateStr}</span>
        </div>
        ${author ? `<p style="margin-bottom: 0.5rem; color: var(--text-muted);">By: ${renderAuthorLink(author)}</p>` : ''}
        ${webUrl ? `<p style="margin-bottom: 1rem;"><a href="${escapeHtml(webUrl)}" target="_blank" rel="noopener" style="color: var(--accent-purple);">🔗 Original Source</a></p>` : ''}
        ${description ? `<div class="markdown-content" style="margin-bottom: 1rem;">${renderMarkdown(description)}</div>` : ''}
        ${articleContent ? `<div class="markdown-content" style="margin-bottom: 1rem;">${renderMarkdown(articleContent)}</div>` : ''}
        ${tags.length > 0 ? `
            <div class="record-tags" style="margin-bottom: 1rem;">
                ${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
        ` : ''}
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

