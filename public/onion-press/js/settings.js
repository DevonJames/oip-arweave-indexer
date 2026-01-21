/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS SETTINGS MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Manages destination settings for browsing and publishing
 */

// Default destinations state
let destinations = {
    arweave: true,
    gun: true,
    thisHost: false
};

// Host info
let hostInfo = {
    name: 'This Host',
    url: window.location.origin
};

// DOM Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsModal = document.getElementById('closeSettingsModal');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingArweave = document.getElementById('settingArweave');
const settingGun = document.getElementById('settingGun');
const settingThisHost = document.getElementById('settingThisHost');
const thisHostName = document.getElementById('thisHostName');
const thisHostUrl = document.getElementById('thisHostUrl');

/**
 * Initialize settings module
 */
function initSettings() {
    // Load saved settings from localStorage
    loadSettings();
    
    // Update UI with current settings
    updateSettingsUI();
    
    // Load host info from server
    loadHostInfo();
    
    // Event listeners
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });
    
    closeSettingsModal.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });
    
    saveSettingsBtn.addEventListener('click', () => {
        saveSettings();
        settingsModal.classList.add('hidden');
        // Trigger browse refresh if on browse tab
        if (typeof loadRecords === 'function') {
            loadRecords();
        }
    });
    
    // Close modal on background click
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });
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
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
    destinations = {
        arweave: settingArweave.checked,
        gun: settingGun.checked,
        thisHost: settingThisHost.checked
    };
    
    localStorage.setItem('onionpress_destinations', JSON.stringify(destinations));
    
    // Dispatch event for other modules
    window.dispatchEvent(new CustomEvent('destinationsChanged', { detail: destinations }));
}

/**
 * Update UI with current settings
 */
function updateSettingsUI() {
    settingArweave.checked = destinations.arweave;
    settingGun.checked = destinations.gun;
    settingThisHost.checked = destinations.thisHost;
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
            thisHostName.textContent = hostInfo.name;
            thisHostUrl.textContent = hostInfo.url;
        }
    } catch (error) {
        console.warn('Failed to load host info:', error);
        // Use defaults
        thisHostName.textContent = hostInfo.name;
        thisHostUrl.textContent = hostInfo.url;
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
