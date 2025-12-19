/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS ADMIN MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// DOM Elements
const adminArweave = document.getElementById('adminArweave');
const adminGun = document.getElementById('adminGun');
const adminIA = document.getElementById('adminIA');
const adminGunPeers = document.getElementById('adminGunPeers');
const adminGunInterval = document.getElementById('adminGunInterval');
const adminGunTrusted = document.getElementById('adminGunTrusted');
const torConnected = document.getElementById('torConnected');
const torOnionAddr = document.getElementById('torOnionAddr');
const copyOnionBtn = document.getElementById('copyOnionBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const resetSettingsBtn = document.getElementById('resetSettingsBtn');
const adminStatus = document.getElementById('adminStatus');

// Initialize admin when tab is shown
const adminNavBtn = document.querySelector('.nav-btn[data-tab="admin"]');
if (adminNavBtn) {
    adminNavBtn.addEventListener('click', () => {
        if (isAdmin()) {
            loadAdminSettings();
        }
    });
}

/**
 * Load admin settings
 */
async function loadAdminSettings() {
    try {
        const data = await getAdminSettings();
        const settings = data.settings || {};
        const torStatus = data.torStatus || {};
        
        // Populate form
        adminArweave.checked = settings.publishToArweave !== false;
        adminGun.checked = settings.publishToGun !== false;
        adminIA.checked = settings.publishToInternetArchive === true;
        adminGunPeers.value = settings.gunExternalPeers || '';
        adminGunInterval.value = settings.gunSyncInterval || 30000;
        adminGunTrusted.value = settings.gunSyncTrustedNodes || '';
        
        // TOR status
        if (torStatus.connected) {
            torConnected.textContent = '🟢 Connected';
            torConnected.classList.add('connected');
            torConnected.classList.remove('disconnected');
        } else {
            torConnected.textContent = '🔴 Disconnected';
            torConnected.classList.remove('connected');
            torConnected.classList.add('disconnected');
        }
        
        torOnionAddr.textContent = torStatus.onionAddress || 'Not available';
        
    } catch (error) {
        showAdminStatus('error', `Failed to load settings: ${error.message}`);
    }
}

/**
 * Save admin settings
 */
saveSettingsBtn?.addEventListener('click', async () => {
    try {
        const settings = {
            publishToArweave: adminArweave.checked,
            publishToGun: adminGun.checked,
            publishToInternetArchive: adminIA.checked,
            gunExternalPeers: adminGunPeers.value,
            gunSyncInterval: parseInt(adminGunInterval.value) || 30000,
            gunSyncTrustedNodes: adminGunTrusted.value
        };
        
        await updateAdminSettings(settings);
        showAdminStatus('success', 'Settings saved successfully!');
        
    } catch (error) {
        showAdminStatus('error', `Failed to save settings: ${error.message}`);
    }
});

/**
 * Reset admin settings
 */
resetSettingsBtn?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset all settings to defaults?')) {
        return;
    }
    
    try {
        await resetAdminSettings();
        await loadAdminSettings();
        showAdminStatus('success', 'Settings reset to defaults!');
        
    } catch (error) {
        showAdminStatus('error', `Failed to reset settings: ${error.message}`);
    }
});

/**
 * Copy onion address
 */
copyOnionBtn?.addEventListener('click', () => {
    const address = torOnionAddr.textContent;
    if (address && address !== 'Not available') {
        navigator.clipboard.writeText(address).then(() => {
            copyOnionBtn.textContent = '✓ Copied!';
            setTimeout(() => {
                copyOnionBtn.textContent = '📋 Copy Address';
            }, 2000);
        });
    }
});

/**
 * Show admin status message
 */
function showAdminStatus(type, message) {
    adminStatus.className = `admin-status ${type}`;
    adminStatus.textContent = message;
    adminStatus.classList.remove('hidden');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        adminStatus.classList.add('hidden');
    }, 5000);
}

