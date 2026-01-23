/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WordPress User Synchronization
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Creates/updates WordPress users when OIP users log in.
 * This enables unified authentication between OIP and WordPress.
 */

const axios = require('axios');

const WORDPRESS_URL = process.env.WORDPRESS_URL || 'http://wordpress:80';
const WORDPRESS_ADMIN_USER = process.env.WORDPRESS_ADMIN_USER || 'admin';
const WORDPRESS_ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || process.env.WORDPRESS_ADMIN_PASSWORD || '';

/**
 * Get WordPress Application Password for REST API authentication
 * Falls back to regular password if Application Password not available
 */
async function getWordPressAuth() {
    // Check if Application Password is provided via env var
    if (process.env.WP_APP_PASSWORD) {
        const appPassword = process.env.WP_APP_PASSWORD.replace(/\s+/g, '');
        return {
            username: WORDPRESS_ADMIN_USER,
            password: appPassword,
            method: 'Application Password'
        };
    }
    
    // Fallback to regular password
    if (WORDPRESS_ADMIN_PASSWORD) {
        return {
            username: WORDPRESS_ADMIN_USER,
            password: WORDPRESS_ADMIN_PASSWORD,
            method: 'Regular Password'
        };
    }
    
    throw new Error('WordPress admin password not configured');
}

/**
 * Create or update a WordPress user from an OIP user account
 * @param {string} email - User email
 * @param {string} username - WordPress username (defaults to email)
 * @param {string} displayName - Display name for WordPress
 * @returns {Promise<object>} WordPress user object or null if failed
 */
async function syncWordPressUser(email, username = null, displayName = null) {
    if (!WORDPRESS_ADMIN_PASSWORD) {
        console.warn('[WordPress Sync] WordPress admin password not configured, skipping user sync');
        return null;
    }

    try {
        const wpUsername = username || email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        const wpDisplayName = displayName || email.split('@')[0];

        // Get authentication credentials (prefer Application Password)
        const auth = await getWordPressAuth();
        
        // Check if user already exists
        const searchResponse = await axios.get(
            `${WORDPRESS_URL}/wp-json/wp/v2/users`,
            {
                params: { search: email },
                auth: {
                    username: auth.username,
                    password: auth.password
                }
            }
        );

        const existingUser = searchResponse.data.find(u => u.email === email);

        if (existingUser) {
            // Update existing user
            console.log(`[WordPress Sync] Updating existing WordPress user: ${email}`);
            const updateResponse = await axios.post(
                `${WORDPRESS_URL}/wp-json/wp/v2/users/${existingUser.id}`,
                {
                    name: wpDisplayName,
                    slug: wpUsername
                },
                {
                    auth: {
                        username: auth.username,
                        password: auth.password
                    }
                }
            );
            return updateResponse.data;
        } else {
            // Create new user
            console.log(`[WordPress Sync] Creating new WordPress user: ${email}`);
            // Generate a random password (user will use OIP login, not WordPress login)
            const randomPassword = require('crypto').randomBytes(16).toString('hex');
            
            const createResponse = await axios.post(
                `${WORDPRESS_URL}/wp-json/wp/v2/users`,
                {
                    username: wpUsername,
                    email: email,
                    name: wpDisplayName,
                    password: randomPassword,
                    roles: ['author'] // Give author permissions
                },
                {
                    auth: {
                        username: auth.username,
                        password: auth.password
                    }
                }
            );
            return createResponse.data;
        }
    } catch (error) {
        console.error('[WordPress Sync] Error syncing WordPress user:', error.message);
        if (error.response) {
            console.error('[WordPress Sync] Response:', error.response.data);
        }
        return null;
    }
}

/**
 * Get WordPress user ID by email
 * @param {string} email - User email
 * @returns {Promise<number|null>} WordPress user ID or null
 */
async function getWordPressUserId(email) {
    if (!WORDPRESS_ADMIN_PASSWORD) {
        return null;
    }

    try {
        const auth = await getWordPressAuth();
        const response = await axios.get(
            `${WORDPRESS_URL}/wp-json/wp/v2/users`,
            {
                params: { search: email },
                auth: {
                    username: auth.username,
                    password: auth.password
                }
            }
        );

        const user = response.data.find(u => u.email === email);
        return user ? user.id : null;
    } catch (error) {
        console.error('[WordPress Sync] Error getting WordPress user ID:', error.message);
        return null;
    }
}

/**
 * Check if a WordPress user is an admin
 * @param {number} wordpressUserId - WordPress user ID
 * @returns {Promise<boolean>} True if user is WordPress admin
 */
async function isWordPressAdmin(wordpressUserId) {
    if (!WORDPRESS_ADMIN_PASSWORD || !wordpressUserId) {
        return false;
    }

    try {
        const auth = await getWordPressAuth();
        const response = await axios.get(
            `${WORDPRESS_URL}/wp-json/wp/v2/users/${wordpressUserId}`,
            {
                auth: {
                    username: auth.username,
                    password: auth.password
                }
            }
        );

        // WordPress admin role is 'administrator'
        const roles = response.data.roles || [];
        return roles.includes('administrator');
    } catch (error) {
        console.error('[WordPress Sync] Error checking WordPress admin status:', error.message);
        return false;
    }
}

/**
 * Get or create an "Anonymous" WordPress user for anonymous posts
 * @returns {Promise<number|null>} WordPress user ID for Anonymous user or null if failed
 */
async function getAnonymousWordPressUser() {
    if (!WORDPRESS_ADMIN_PASSWORD) {
        return null;
    }

    try {
        const auth = await getWordPressAuth();
        
        // Search for existing "Anonymous" user
        const searchResponse = await axios.get(
            `${WORDPRESS_URL}/wp-json/wp/v2/users`,
            {
                params: { search: 'anonymous' },
                auth: {
                    username: auth.username,
                    password: auth.password
                }
            }
        );

        // Look for user with username "anonymous" or display name "Anonymous"
        const anonymousUser = searchResponse.data.find(u => 
            u.slug === 'anonymous' || 
            u.name.toLowerCase() === 'anonymous' ||
            u.username.toLowerCase() === 'anonymous'
        );

        if (anonymousUser) {
            console.log(`[WordPress Sync] Found existing Anonymous user (ID: ${anonymousUser.id})`);
            return anonymousUser.id;
        }

        // Create Anonymous user if it doesn't exist
        console.log(`[WordPress Sync] Creating Anonymous WordPress user`);
        const randomPassword = require('crypto').randomBytes(16).toString('hex');
        
        const createResponse = await axios.post(
            `${WORDPRESS_URL}/wp-json/wp/v2/users`,
            {
                username: 'anonymous',
                email: 'anonymous@localhost.invalid',
                name: 'Anonymous',
                password: randomPassword,
                roles: ['author'] // Give author permissions
            },
            {
                auth: {
                    username: auth.username,
                    password: auth.password
                }
            }
        );
        
        console.log(`[WordPress Sync] Created Anonymous WordPress user (ID: ${createResponse.data.id})`);
        return createResponse.data.id;
    } catch (error) {
        console.error('[WordPress Sync] Error getting Anonymous user:', error.message);
        if (error.response) {
            console.error('[WordPress Sync] Response:', error.response.data);
        }
        return null;
    }
}

module.exports = {
    syncWordPressUser,
    getWordPressUserId,
    isWordPressAdmin,
    getAnonymousWordPressUser
};
