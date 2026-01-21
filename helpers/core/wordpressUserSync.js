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

        // Check if user already exists
        const searchResponse = await axios.get(
            `${WORDPRESS_URL}/wp-json/wp/v2/users`,
            {
                params: { search: email },
                auth: {
                    username: WORDPRESS_ADMIN_USER,
                    password: WORDPRESS_ADMIN_PASSWORD
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
                        username: WORDPRESS_ADMIN_USER,
                        password: WORDPRESS_ADMIN_PASSWORD
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
                        username: WORDPRESS_ADMIN_USER,
                        password: WORDPRESS_ADMIN_PASSWORD
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
        const response = await axios.get(
            `${WORDPRESS_URL}/wp-json/wp/v2/users`,
            {
                params: { search: email },
                auth: {
                    username: WORDPRESS_ADMIN_USER,
                    password: WORDPRESS_ADMIN_PASSWORD
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
        const response = await axios.get(
            `${WORDPRESS_URL}/wp-json/wp/v2/users/${wordpressUserId}`,
            {
                auth: {
                    username: WORDPRESS_ADMIN_USER,
                    password: WORDPRESS_ADMIN_PASSWORD
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

module.exports = {
    syncWordPressUser,
    getWordPressUserId,
    isWordPressAdmin
};
