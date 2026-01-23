#!/usr/bin/env node

/**
 * Test WordPress Application Password Authentication
 * 
 * This script helps verify that WP_APP_PASSWORD is correctly configured
 * and can authenticate with WordPress REST API.
 * 
 * Usage:
 *   node scripts/test-wordpress-auth.js
 * 
 * Or with custom values:
 *   WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx" WP_ADMIN_USER="devon" WORDPRESS_URL="http://wordpress:80" node scripts/test-wordpress-auth.js
 */

require('dotenv').config();
const axios = require('axios');

const WORDPRESS_URL = process.env.WORDPRESS_URL || 'http://wordpress:80';
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || process.env.WORDPRESS_ADMIN_USER || 'admin';
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const WP_ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || process.env.WORDPRESS_ADMIN_PASSWORD;

console.log('═══════════════════════════════════════════════════════════════');
console.log('  WORDPRESS AUTHENTICATION TEST');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`WordPress URL: ${WORDPRESS_URL}`);
console.log(`Admin User: ${WP_ADMIN_USER}`);
console.log(`Application Password: ${WP_APP_PASSWORD ? `${WP_APP_PASSWORD.substring(0, 8)}... (${WP_APP_PASSWORD.length} chars)` : 'NOT SET'}`);
console.log(`Regular Password: ${WP_ADMIN_PASSWORD ? 'SET' : 'NOT SET'}`);
console.log('═══════════════════════════════════════════════════════════════\n');

async function testAuth(username, password, method) {
    console.log(`\n🔍 Testing ${method}...`);
    console.log(`   Username: ${username}`);
    console.log(`   Password length: ${password.length} chars`);
    
    const endpoints = [
        `${WORDPRESS_URL}/wp-json/wp/v2/users/me`,
        `${WORDPRESS_URL}/wp-json/wp/v2/users/me/`,
        `${WORDPRESS_URL}/index.php?rest_route=/wp/v2/users/me`
    ];
    
    for (const endpoint of endpoints) {
        try {
            console.log(`   Trying: ${endpoint}`);
            const response = await axios.get(endpoint, {
                auth: {
                    username: username,
                    password: password
                },
                validateStatus: () => true,
                timeout: 5000,
                maxRedirects: 5,
                transformResponse: [(data) => data] // Keep as-is to detect HTML
            });
            
            // Check if we got HTML
            const isHtml = typeof response.data === 'string' && (
                response.data.trim().startsWith('<!DOCTYPE') ||
                response.data.trim().startsWith('<html') ||
                response.data.includes('<body')
            );
            
            if (isHtml) {
                console.log(`   ❌ Returned HTML (likely login page)`);
                continue;
            }
            
            if (response.status === 200) {
                let userData = response.data;
                if (typeof userData === 'string') {
                    try {
                        userData = JSON.parse(userData);
                    } catch (e) {
                        console.log(`   ❌ Not valid JSON`);
                        continue;
                    }
                }
                
                if (userData && userData.id) {
                    console.log(`   ✅ SUCCESS!`);
                    console.log(`   ✅ Authenticated as: ${userData.name} (${userData.slug})`);
                    console.log(`   ✅ User ID: ${userData.id}`);
                    console.log(`   ✅ Email: ${userData.email}`);
                    console.log(`   ✅ Roles: ${userData.roles?.join(', ') || 'none'}`);
                    console.log(`   ✅ Working endpoint: ${endpoint}`);
                    return { success: true, userData, endpoint };
                }
            } else if (response.status === 401) {
                console.log(`   ❌ 401 Unauthorized`);
                // Try to show the error response
                if (response.data) {
                    if (typeof response.data === 'string') {
                        // Check if it's HTML
                        if (response.data.includes('<html') || response.data.includes('<!DOCTYPE')) {
                            console.log(`   Response is HTML (likely login page)`);
                            console.log(`   Preview: ${response.data.substring(0, 200)}`);
                        } else {
                            try {
                                const errorData = JSON.parse(response.data);
                                console.log(`   Error: ${JSON.stringify(errorData, null, 2)}`);
                            } catch (e) {
                                console.log(`   Error response: ${response.data.substring(0, 200)}`);
                            }
                        }
                    } else if (typeof response.data === 'object') {
                        console.log(`   Error: ${JSON.stringify(response.data, null, 2)}`);
                    }
                }
                // Show response headers for debugging
                console.log(`   Response headers: ${JSON.stringify(response.headers, null, 2)}`);
            } else {
                console.log(`   ❌ Status ${response.status}`);
                if (response.data) {
                    console.log(`   Response: ${typeof response.data === 'string' ? response.data.substring(0, 200) : JSON.stringify(response.data)}`);
                }
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }
    
    return { success: false };
}

async function testRESTAPI() {
    console.log('\n🔍 Testing WordPress REST API availability...');
    try {
        // Test without auth first
        const response = await axios.get(`${WORDPRESS_URL}/wp-json/`, {
            validateStatus: () => true,
            timeout: 5000
        });
        
        if (response.status === 200) {
            console.log('✅ WordPress REST API is accessible');
            if (response.data && response.data.name) {
                console.log(`   Site: ${response.data.name}`);
            }
            if (response.data && response.data.routes) {
                const routes = Object.keys(response.data.routes);
                console.log(`   Available routes: ${routes.length}`);
                if (routes.includes('/wp/v2/users/me')) {
                    console.log('   ✅ /wp/v2/users/me endpoint exists');
                } else {
                    console.log('   ⚠️  /wp/v2/users/me endpoint not found');
                }
            }
        } else {
            console.log(`⚠️  WordPress REST API returned status ${response.status}`);
        }
    } catch (error) {
        console.log(`❌ Cannot reach WordPress REST API: ${error.message}`);
    }
}

async function main() {
    // First test if REST API is available
    await testRESTAPI();
    
    const results = [];
    
    // Test Application Password if set
    if (WP_APP_PASSWORD) {
        console.log('\n📱 Testing Application Password...');
        console.log(`   Original format: "${WP_APP_PASSWORD}"`);
        console.log(`   Length: ${WP_APP_PASSWORD.length} chars`);
        
        // Try BOTH formats: with spaces AND without spaces
        const appPasswordWithSpaces = WP_APP_PASSWORD; // Keep original format
        const appPasswordWithoutSpaces = WP_APP_PASSWORD.replace(/\s+/g, ''); // Remove spaces
        
        console.log(`   Testing WITH spaces: "${appPasswordWithSpaces}"`);
        console.log(`   Testing WITHOUT spaces: "${appPasswordWithoutSpaces}"`);
        
        // Try common usernames
        const usernames = ['devon', WP_ADMIN_USER, 'admin'];
        const uniqueUsernames = [...new Set(usernames)];
        
        for (const username of uniqueUsernames) {
            // Try WITH spaces first (WordPress displays them this way)
            console.log(`\n   Testing username "${username}" WITH spaces...`);
            const resultWithSpaces = await testAuth(username, appPasswordWithSpaces, `Application Password WITH spaces (${username})`);
            if (resultWithSpaces.success) {
                console.log(`\n✅ Application Password works WITH SPACES for username: ${username}`);
                results.push({ method: 'Application Password (with spaces)', username, ...resultWithSpaces });
                break;
            }
            
            // Try WITHOUT spaces
            console.log(`\n   Testing username "${username}" WITHOUT spaces...`);
            const resultWithoutSpaces = await testAuth(username, appPasswordWithoutSpaces, `Application Password WITHOUT spaces (${username})`);
            if (resultWithoutSpaces.success) {
                console.log(`\n✅ Application Password works WITHOUT SPACES for username: ${username}`);
                results.push({ method: 'Application Password (without spaces)', username, ...resultWithoutSpaces });
                break;
            }
        }
    } else {
        console.log('\n⚠️  WP_APP_PASSWORD not set, skipping Application Password test');
    }
    
    // Test regular password if set
    if (WP_ADMIN_PASSWORD) {
        console.log('\n🔑 Testing Regular Password...');
        const result = await testAuth(WP_ADMIN_USER, WP_ADMIN_PASSWORD, 'Regular Password');
        if (result.success) {
            results.push({ method: 'Regular Password', username: WP_ADMIN_USER, ...result });
        }
    } else {
        console.log('\n⚠️  WP_ADMIN_PASSWORD not set, skipping Regular Password test');
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    
    if (results.length > 0) {
        console.log('✅ Authentication successful!');
        results.forEach(r => {
            console.log(`   Method: ${r.method}`);
            console.log(`   Username: ${r.username}`);
            console.log(`   User: ${r.userData.name} (ID: ${r.userData.id})`);
            console.log(`   Endpoint: ${r.endpoint}`);
        });
    } else {
        console.log('❌ Authentication failed for all methods');
        console.log('\nTroubleshooting:');
        console.log('1. Verify WP_APP_PASSWORD matches the plain text password shown when created');
        console.log('2. Application Passwords are user-specific - make sure it\'s for the correct user');
        console.log('3. Check WordPress logs for authentication errors');
        console.log('4. Try creating a new Application Password:');
        console.log('   docker exec -it onionpress-wordpress-1 wp user application-password create devon "OIP Test" --allow-root');
        console.log('5. Copy the plain text password (format: xxxx xxxx xxxx xxxx xxxx xxxx)');
        console.log('6. Set it in .env as WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"');
    }
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    process.exit(results.length > 0 ? 0 : 1);
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
