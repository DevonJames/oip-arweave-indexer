/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Theme Management - Light/Dark Mode Toggle
 * ═══════════════════════════════════════════════════════════════════════════════
 */

(function() {
    'use strict';

    const THEME_STORAGE_KEY = 'onion-press-theme';
    const THEME_ATTRIBUTE = 'data-theme';
    
    // Default to dark mode
    const DEFAULT_THEME = 'dark';
    
    /**
     * Get current theme from localStorage or default
     */
    function getStoredTheme() {
        try {
            return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
        } catch (e) {
            console.warn('Failed to read theme from localStorage:', e);
            return DEFAULT_THEME;
        }
    }
    
    /**
     * Store theme preference
     */
    function storeTheme(theme) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (e) {
            console.warn('Failed to store theme in localStorage:', e);
        }
    }
    
    /**
     * Apply theme to document
     */
    function applyTheme(theme) {
        const html = document.documentElement;
        
        if (theme === 'light') {
            html.setAttribute(THEME_ATTRIBUTE, 'light');
        } else {
            html.removeAttribute(THEME_ATTRIBUTE);
        }
        
        // Update toggle button icon
        updateThemeToggleIcon(theme);
    }
    
    /**
     * Update theme toggle button icon
     */
    function updateThemeToggleIcon(theme) {
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
            toggleBtn.setAttribute('title', theme === 'light' 
                ? 'Switch to dark mode' 
                : 'Switch to light mode');
        }
    }
    
    /**
     * Toggle between light and dark mode
     */
    function toggleTheme() {
        const currentTheme = getStoredTheme();
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        applyTheme(newTheme);
        storeTheme(newTheme);
    }
    
    /**
     * Initialize theme on page load
     */
    function initTheme() {
        const storedTheme = getStoredTheme();
        applyTheme(storedTheme);
        
        // Attach click handler to toggle button
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleTheme);
        }
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme);
    } else {
        initTheme();
    }
    
    // Export for manual use if needed
    window.OnionPressTheme = {
        toggle: toggleTheme,
        setTheme: function(theme) {
            if (theme === 'light' || theme === 'dark') {
                applyTheme(theme);
                storeTheme(theme);
            }
        },
        getTheme: getStoredTheme
    };
})();
