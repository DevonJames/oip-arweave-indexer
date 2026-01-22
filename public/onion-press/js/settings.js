/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS SETTINGS MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Manages destination settings for browsing and publishing
 */

// Default destinations state (will be loaded from server)
let destinations = {
    arweave: false,
    gun: false,
    thisHost: true
};

// Host info
let hostInfo = {
    name: 'This Host',
    url: window.location.origin
};

// DOM Elements (will be set during initialization)
let settingsBtn, settingsModal, closeSettingsModal, saveDestinationsBtn;
let settingArweave, settingGun, settingThisHost, thisHostName, thisHostUrl;

/**
 * Initialize settings module
 */
async function initSettings() {
    // Get DOM elements
    settingsBtn = document.getElementById('settingsBtn');
    settingsModal = document.getElementById('settingsModal');
    closeSettingsModal = document.getElementById('closeSettingsModal');
    saveDestinationsBtn = document.getElementById('saveDestinationsBtn');
    settingArweave = document.getElementById('settingArweave');
    settingGun = document.getElementById('settingGun');
    settingThisHost = document.getElementById('settingThisHost');
    thisHostName = document.getElementById('thisHostName');
    thisHostUrl = document.getElementById('thisHostUrl');
    
    // Check if required elements exist
    if (!settingsBtn || !settingsModal) {
        console.warn('Settings elements not found, skipping initialization');
        return;
    }
    
    // Load default destinations from server first, then load saved settings
    await loadDefaultDestinations();
    loadSettings();
    
    console.log('Destinations loaded:', destinations);
    
    // Update UI with current settings
    updateSettingsUI();
    
    // Load host info from server
    loadHostInfo();
    
    // Event listeners
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });
    
    if (closeSettingsModal) {
        closeSettingsModal.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }
    
    if (saveDestinationsBtn) {
        saveDestinationsBtn.addEventListener('click', () => {
            saveSettings();
            settingsModal.classList.add('hidden');
            // Trigger browse refresh if on browse tab
            if (typeof loadRecords === 'function') {
                loadRecords();
            }
        });
    }
    
    // Close modal on background click
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });
}

/**
 * Load default destinations from server (based on .env variables)
 */
async function loadDefaultDestinations() {
    try {
        const response = await fetch('/onion-press/api/destinations/defaults');
        if (response.ok) {
            const data = await response.json();
            console.log('Default destinations from server:', data.destinations);
            if (data.destinations) {
                // Set defaults from server (only if no saved settings exist)
                const saved = localStorage.getItem('onionpress_destinations');
                if (!saved) {
                    destinations = { ...data.destinations };
                    console.log('Using server defaults:', destinations);
                } else {
                    console.log('Using saved settings:', JSON.parse(saved));
                }
            }
        } else {
            console.warn('Failed to load default destinations, status:', response.status);
        }
    } catch (error) {
        console.warn('Failed to load default destinations:', error);
        // Keep current defaults
    }
}

/**
 * Load settings from localStorage
 */
function loadSettings() {
    const saved = localStorage.getItem('onionpress_destinations');
    if (saved) {
        try {
            destinations = JSON.parse(saved);
        } catch (e) {
            console.warn('Failed to parse saved destinations:', e);
        }
    }
    // If no saved settings, defaults from loadDefaultDestinations() will be used
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
    destinations = {
        arweave: settingArweave ? settingArweave.checked : true,
        gun: settingGun ? settingGun.checked : true,
        thisHost: settingThisHost ? settingThisHost.checked : false
    };
    
    localStorage.setItem('onionpress_destinations', JSON.stringify(destinations));
    
    // Dispatch event for other modules
    window.dispatchEvent(new CustomEvent('destinationsChanged', { detail: destinations }));
}

/**
 * Update UI with current settings
 */
function updateSettingsUI() {
    if (settingArweave) settingArweave.checked = destinations.arweave;
    if (settingGun) settingGun.checked = destinations.gun;
    if (settingThisHost) settingThisHost.checked = destinations.thisHost;
}

/**
 * Load host info from server
 */
async function loadHostInfo() {
    try {
        const response = await fetch('/onion-press/api/host-info');
        if (response.ok) {
            const data = await response.json();
            hostInfo = data;
            if (thisHostName) thisHostName.textContent = hostInfo.name;
            // Update the link in the description
            const thisHostLink = document.getElementById('thisHostLink');
            if (thisHostLink) {
                thisHostLink.textContent = hostInfo.name;
                thisHostLink.href = hostInfo.url;
            }
        }
    } catch (error) {
        console.warn('Failed to load host info:', error);
        // Use defaults
        if (thisHostName) thisHostName.textContent = hostInfo.name;
        const thisHostLink = document.getElementById('thisHostLink');
        if (thisHostLink) {
            thisHostLink.textContent = hostInfo.name;
            thisHostLink.href = hostInfo.url;
        }
    }
}

/**
 * Get current destinations
 */
function getDestinations() {
    return { ...destinations };
}

/**
 * Check if a destination is enabled
 */
function isDestinationEnabled(destination) {
    return destinations[destination] === true;
}

// Export for use in other modules
window.onionPressSettings = {
    getDestinations,
    isDestinationEnabled,
    initSettings
};

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettings);
} else {
    initSettings();
}
