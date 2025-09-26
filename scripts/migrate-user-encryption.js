#!/usr/bin/env node

/**
 * Migration Script: Upgrade User Encryption from PBKDF2 to AES-256-GCM
 * 
 * This script upgrades existing users from the legacy PBKDF2 encryption (one-way)
 * to the new AES-256-GCM encryption (reversible) for mnemonics and private keys.
 * 
 * IMPORTANT: This requires user passwords to re-encrypt their data.
 * Users will need to log in after migration to complete the upgrade.
 * 
 * Usage:
 *   node scripts/migrate-user-encryption.js [--dry-run] [--user-email=email]
 */

const { elasticClient } = require('../helpers/elasticsearch');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const minimist = require('minimist');

class UserEncryptionMigration {
    constructor(options = {}) {
        this.dryRun = options.dryRun || false;
        this.userEmail = options.userEmail || null;
        this.stats = {
            totalUsers: 0,
            legacyUsers: 0,
            alreadyMigrated: 0,
            migrationNeeded: 0,
            errors: 0
        };
    }
    
    /**
     * Main migration function
     */
    async migrate() {
        try {
            console.log('🔄 Starting User Encryption Migration...');
            console.log(`   Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
            console.log(`   Target: ${this.userEmail || 'ALL USERS'}`);
            console.log('');
            
            // Get all users or specific user
            const users = await this.getAllUsers();
            this.stats.totalUsers = users.length;
            
            console.log(`📊 Found ${users.length} users to analyze`);
            console.log('');
            
            for (const user of users) {
                await this.analyzeUser(user);
            }
            
            this.printSummary();
            
        } catch (error) {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        }
    }
    
    /**
     * Get all users from Elasticsearch
     */
    async getAllUsers() {
        try {
            const query = this.userEmail ? {
                term: { email: this.userEmail }
            } : {
                match_all: {}
            };
            
            const searchResult = await elasticClient.search({
                index: 'users',
                body: {
                    query: query,
                    size: 1000 // Adjust if you have more users
                }
            });
            
            return searchResult.hits.hits.map(hit => ({
                id: hit._id,
                ...hit._source
            }));
            
        } catch (error) {
            console.error('❌ Error fetching users:', error);
            throw error;
        }
    }
    
    /**
     * Analyze a single user for migration needs
     */
    async analyzeUser(user) {
        try {
            console.log(`👤 Analyzing user: ${user.email}`);
            
            // Check if user has wallet data
            if (!user.encryptedMnemonic || !user.encryptedPrivateKey) {
                console.log('   ⚠️  No wallet data found - skipping');
                return;
            }
            
            // Check encryption format
            const mnemonicIsLegacy = !user.encryptedMnemonic.startsWith('{');
            const privateKeyIsLegacy = !user.encryptedPrivateKey.startsWith('{');
            
            if (!mnemonicIsLegacy && !privateKeyIsLegacy) {
                console.log('   ✅ Already using AES encryption - no migration needed');
                this.stats.alreadyMigrated++;
                return;
            }
            
            if (mnemonicIsLegacy || privateKeyIsLegacy) {
                console.log('   🔄 Legacy encryption detected:');
                console.log(`      Mnemonic: ${mnemonicIsLegacy ? 'PBKDF2 (legacy)' : 'AES (new)'}`);
                console.log(`      Private Key: ${privateKeyIsLegacy ? 'PBKDF2 (legacy)' : 'AES (new)'}`);
                console.log('   ⚠️  Migration required - user must log in to complete upgrade');
                
                this.stats.legacyUsers++;
                this.stats.migrationNeeded++;
                
                if (!this.dryRun) {
                    // Mark user as needing migration
                    await this.markUserForMigration(user);
                }
            }
            
        } catch (error) {
            console.error(`❌ Error analyzing user ${user.email}:`, error);
            this.stats.errors++;
        }
    }
    
    /**
     * Mark user as needing encryption migration
     */
    async markUserForMigration(user) {
        try {
            await elasticClient.update({
                index: 'users',
                id: user.id,
                body: {
                    doc: {
                        encryptionMigrationNeeded: true,
                        encryptionMigrationMarkedAt: new Date().toISOString()
                    }
                },
                refresh: 'wait_for'
            });
            
            console.log('   📝 Marked user for encryption migration');
            
        } catch (error) {
            console.error(`❌ Error marking user for migration:`, error);
            throw error;
        }
    }
    
    /**
     * Print migration summary
     */
    printSummary() {
        console.log('');
        console.log('📊 Migration Summary:');
        console.log('=====================================');
        console.log(`Total Users Analyzed:     ${this.stats.totalUsers}`);
        console.log(`Already Migrated (AES):   ${this.stats.alreadyMigrated}`);
        console.log(`Legacy Users (PBKDF2):    ${this.stats.legacyUsers}`);
        console.log(`Migration Needed:         ${this.stats.migrationNeeded}`);
        console.log(`Errors:                   ${this.stats.errors}`);
        console.log('');
        
        if (this.stats.migrationNeeded > 0) {
            console.log('🔄 Next Steps:');
            console.log('   1. Legacy users need to log in to complete encryption upgrade');
            console.log('   2. After login, they will have AES encryption and can export mnemonics');
            console.log('   3. Organization queue processing will work for upgraded accounts');
            console.log('');
        }
        
        if (this.dryRun) {
            console.log('💡 This was a dry run - no changes were made');
            console.log('   Run without --dry-run to mark users for migration');
        }
    }
}

// CLI interface
async function main() {
    const args = minimist(process.argv.slice(2));
    
    const options = {
        dryRun: args['dry-run'] || false,
        userEmail: args['user-email'] || null
    };
    
    const migration = new UserEncryptionMigration(options);
    await migration.migrate();
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Migration script failed:', error);
        process.exit(1);
    });
}

module.exports = { UserEncryptionMigration };
