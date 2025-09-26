#!/usr/bin/env node

/**
 * Migration Script: Add GUN Encryption Salt to Existing Users
 * 
 * This script adds user-specific GUN encryption salts to existing users who don't have them.
 * This enables per-user encryption for GUN records instead of the shared key system.
 * 
 * IMPORTANT: This migration requires user passwords to encrypt the salt.
 * For production, users should re-authenticate to get their salt generated.
 * 
 * Usage:
 *   node scripts/migrate-users-gun-salt.js [--dry-run] [--force]
 */

const { elasticClient } = require('../helpers/elasticsearch');
const crypto = require('crypto');
const minimist = require('minimist');

// Import encryption functions from user.js
function encryptSaltWithPassword(salt, password) {
    // Generate encryption key from password
    const key = crypto.pbkdf2Sync(password, 'oip-salt-encryption', 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12); // 12-byte IV for GCM
    
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(salt, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Return as JSON string with all components
    return JSON.stringify({
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
    });
}

class UserGunSaltMigration {
    constructor(options = {}) {
        this.dryRun = options.dryRun || false;
        this.force = options.force || false;
        this.stats = {
            totalUsers: 0,
            usersWithSalt: 0,
            usersNeedingSalt: 0,
            saltGenerated: 0,
            errors: 0
        };
    }
    
    /**
     * Main migration function
     */
    async migrate() {
        console.log('🔄 Starting GUN encryption salt migration for existing users...');
        console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
        console.log('');
        
        console.log('⚠️  IMPORTANT SECURITY NOTICE:');
        console.log('   This migration adds user-specific encryption salts for GUN records.');
        console.log('   Users will need to re-authenticate for their salt to be generated.');
        console.log('   Existing encrypted records may need to be re-encrypted with new keys.');
        console.log('');
        
        try {
            // Get all users from Elasticsearch
            const users = await this.getAllUsers();
            this.stats.totalUsers = users.length;
            
            console.log(`📊 Found ${users.length} users in the system`);
            
            if (users.length === 0) {
                console.log('✅ No users found - migration complete');
                return this.stats;
            }
            
            // Analyze current state
            await this.analyzeUsers(users);
            
            // Process users that need salt
            if (this.stats.usersNeedingSalt > 0) {
                console.log(`\n🔑 Processing ${this.stats.usersNeedingSalt} users that need GUN encryption salt...`);
                await this.processUsersNeedingSalt(users);
            }
            
            // Print final statistics
            this.printMigrationSummary();
            
            return this.stats;
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            throw error;
        }
    }
    
    /**
     * Get all users from Elasticsearch
     */
    async getAllUsers() {
        try {
            const searchResult = await elasticClient.search({
                index: 'users',
                body: {
                    query: { match_all: {} },
                    sort: [{ "createdAt": { order: "asc" } }]
                },
                size: 10000
            });
            
            return searchResult.hits.hits.map(hit => ({
                id: hit._id,
                source: hit._source
            }));
            
        } catch (error) {
            console.error('❌ Error fetching users:', error);
            throw error;
        }
    }
    
    /**
     * Analyze users to see who needs salt
     */
    async analyzeUsers(users) {
        console.log('\n📊 Analyzing user encryption salt status...');
        
        for (const userData of users) {
            const user = userData.source;
            
            if (user.encryptedGunSalt) {
                this.stats.usersWithSalt++;
                console.log(`✅ User has salt: ${user.email}`);
            } else {
                this.stats.usersNeedingSalt++;
                console.log(`❌ User needs salt: ${user.email}`);
            }
        }
        
        console.log('\n📈 Analysis Results:');
        console.log(`   Users with GUN salt: ${this.stats.usersWithSalt}`);
        console.log(`   Users needing salt: ${this.stats.usersNeedingSalt}`);
    }
    
    /**
     * Process users that need salt
     */
    async processUsersNeedingSalt(users) {
        const usersNeedingSalt = users.filter(userData => !userData.source.encryptedGunSalt);
        
        for (const userData of usersNeedingSalt) {
            await this.processUser(userData);
        }
    }
    
    /**
     * Process a single user for salt generation
     */
    async processUser(userData) {
        try {
            const user = userData.source;
            const userId = userData.id;
            
            console.log(`\n🔑 Processing user: ${user.email}`);
            
            if (this.dryRun) {
                console.log(`🔍 [DRY RUN] Would generate GUN encryption salt for: ${user.email}`);
                this.stats.saltGenerated++;
                return;
            }
            
            // Generate new encryption salt
            const gunEncryptionSalt = crypto.randomBytes(32).toString('hex');
            console.log(`🔑 Generated new salt: ${gunEncryptionSalt.slice(0, 8)}...`);
            
            // For migration, we'll store an unencrypted placeholder salt
            // Users will need to re-authenticate to get it properly encrypted with their password
            const migrationSaltData = {
                isMigrationPlaceholder: true,
                plaintextSalt: gunEncryptionSalt,
                migrationDate: new Date().toISOString(),
                needsPasswordEncryption: true
            };
            
            // Store as JSON string (will be replaced when user re-authenticates)
            const placeholderEncryptedSalt = JSON.stringify(migrationSaltData);
            
            // Update user record
            await elasticClient.update({
                index: 'users',
                id: userId,
                body: {
                    doc: {
                        encryptedGunSalt: placeholderEncryptedSalt,
                        gunSaltMigrationDate: new Date().toISOString()
                    }
                },
                refresh: 'wait_for'
            });
            
            this.stats.saltGenerated++;
            console.log(`✅ Added migration placeholder salt for: ${user.email}`);
            console.log(`   Note: User must re-authenticate to properly encrypt their salt`);
            
        } catch (error) {
            console.error(`❌ Error processing user ${userData.source.email}:`, error);
            this.stats.errors++;
        }
    }
    
    /**
     * Print migration summary
     */
    printMigrationSummary() {
        console.log('\n📊 GUN Salt Migration Summary:');
        console.log('===============================');
        console.log(`Total users found: ${this.stats.totalUsers}`);
        console.log(`Users already with salt: ${this.stats.usersWithSalt}`);
        console.log(`Users needing salt: ${this.stats.usersNeedingSalt}`);
        console.log(`Salts generated: ${this.stats.saltGenerated}`);
        console.log(`Errors encountered: ${this.stats.errors}`);
        
        if (this.dryRun) {
            console.log('\n🔍 This was a DRY RUN - no actual changes were made');
            console.log('Run without --dry-run to perform the actual migration');
        } else if (this.stats.saltGenerated > 0) {
            console.log('\n✅ Migration completed successfully!');
            console.log('');
            console.log('🔑 IMPORTANT: Users must re-authenticate to properly encrypt their salts');
            console.log('   - Migration created placeholder salts');
            console.log('   - When users log in, salts will be properly encrypted with their passwords');
            console.log('   - Until then, they can only decrypt legacy records');
        }
    }
}

// Main execution
async function main() {
    const args = minimist(process.argv.slice(2));
    const options = {
        dryRun: args['dry-run'] || args.dryRun || false,
        force: args.force || false
    };
    
    console.log('🔑 OIP User GUN Salt Migration Tool');
    console.log('===================================');
    console.log('Options:', options);
    console.log('');
    
    try {
        const migration = new UserGunSaltMigration(options);
        await migration.migrate();
        
        console.log('\n🎉 Migration completed successfully!');
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { UserGunSaltMigration };
