#!/usr/bin/env node

/**
 * Migration Script: Existing GUN Records to Registry
 * 
 * This script migrates existing GUN records from Elasticsearch to the GUN registry system
 * for discovery by other OIP nodes. Run this once when deploying the sync system.
 * 
 * Usage:
 *   node scripts/migrate-existing-gun-records.js [--dry-run] [--force]
 */

const { elasticClient } = require('../helpers/elasticsearch');
const { OIPGunRegistry } = require('../helpers/oipGunRegistry');
const minimist = require('minimist');

class ExistingRecordMigration {
    constructor(options = {}) {
        this.registry = new OIPGunRegistry();
        this.dryRun = options.dryRun || false;
        this.force = options.force || false;
        this.stats = {
            totalFound: 0,
            totalRegistered: 0,
            errors: 0,
            skipped: 0
        };
    }
    
    /**
     * Main migration function
     */
    async migrate() {
        console.log('🔄 Starting migration of existing GUN records to registry...');
        console.log(`Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`);
        
        try {
            // Get all existing GUN records from Elasticsearch
            const existingRecords = await this.getExistingGunRecords();
            this.stats.totalFound = existingRecords.length;
            
            console.log(`📊 Found ${existingRecords.length} existing GUN records in Elasticsearch`);
            
            if (existingRecords.length === 0) {
                console.log('✅ No existing GUN records found - migration complete');
                return this.stats;
            }
            
            // Process each record
            for (const record of existingRecords) {
                await this.processRecord(record);
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
     * Get all existing GUN records from Elasticsearch
     */
    async getExistingGunRecords() {
        try {
            const searchResult = await elasticClient.search({
                index: 'records',
                body: {
                    query: {
                        bool: {
                            should: [
                                { prefix: { "oip.did": "did:gun:" } },
                                { prefix: { "oip.didTx": "did:gun:" } }
                            ]
                        }
                    },
                    sort: [
                        { "oip.indexedAt": { order: "asc" } }
                    ]
                },
                size: 10000 // Adjust if you have more than 10k GUN records
            });
            
            return searchResult.hits.hits.map(hit => ({
                id: hit._id,
                source: hit._source
            }));
            
        } catch (error) {
            console.error('❌ Error fetching existing GUN records:', error);
            throw error;
        }
    }
    
    /**
     * Process a single record for migration
     */
    async processRecord(recordData) {
        try {
            const record = recordData.source;
            const did = record.oip.did || record.oip.didTx;
            const soul = did.replace('did:gun:', '');
            
            console.log(`📝 Processing record: ${did}`);
            
            // Validate record structure
            if (!this.validateRecord(record)) {
                console.warn(`⚠️ Invalid record structure, skipping: ${did}`);
                this.stats.skipped++;
                return;
            }
            
            // Check if already registered (unless force mode)
            if (!this.force) {
                const alreadyRegistered = await this.checkIfAlreadyRegistered(soul);
                if (alreadyRegistered) {
                    console.log(`⏭️ Record already registered, skipping: ${did}`);
                    this.stats.skipped++;
                    return;
                }
            }
            
            if (this.dryRun) {
                console.log(`🔍 [DRY RUN] Would register: ${did}`);
                this.stats.totalRegistered++;
                return;
            }
            
            // Register in the GUN registry
            await this.registry.registerOIPRecord(
                did,
                soul,
                record.oip.recordType,
                record.oip.creator.publicKey
            );
            
            this.stats.totalRegistered++;
            console.log(`✅ Registered: ${did}`);
            
        } catch (error) {
            console.error(`❌ Error processing record ${recordData.id}:`, error);
            this.stats.errors++;
        }
    }
    
    /**
     * Validate record structure
     */
    validateRecord(record) {
        return record &&
               record.oip &&
               record.oip.recordType &&
               record.oip.creator &&
               record.oip.creator.publicKey &&
               record.data;
    }
    
    /**
     * Check if record is already registered in the registry
     */
    async checkIfAlreadyRegistered(soul) {
        try {
            // Check in node-specific registry
            const nodeRegistryKey = `${this.registry.registryRoot}:nodes:${this.registry.nodeId}`;
            const existingEntry = await this.registry.gunHelper.getRecord(`${nodeRegistryKey}:${soul}`);
            
            return !!existingEntry;
            
        } catch (error) {
            // If we can't check, assume not registered
            return false;
        }
    }
    
    /**
     * Print migration summary
     */
    printMigrationSummary() {
        console.log('\n📊 Migration Summary:');
        console.log('====================');
        console.log(`Total records found: ${this.stats.totalFound}`);
        console.log(`Records registered: ${this.stats.totalRegistered}`);
        console.log(`Records skipped: ${this.stats.skipped}`);
        console.log(`Errors encountered: ${this.stats.errors}`);
        
        if (this.dryRun) {
            console.log('\n🔍 This was a DRY RUN - no actual changes were made');
            console.log('Run without --dry-run to perform the actual migration');
        } else {
            console.log('\n✅ Migration completed successfully!');
            console.log('Other OIP nodes should now be able to discover these records');
        }
    }
}

/**
 * User Migration Service
 * Handles synchronization of user metadata between OIP instances
 */
class UserMigrationService {
    constructor(options = {}) {
        this.registry = new OIPGunRegistry();
        this.dryRun = options.dryRun || false;
        this.userRegistrySoul = 'oip:users:registry';
        this.stats = {
            totalUsers: 0,
            usersRegistered: 0,
            errors: 0
        };
    }
    
    /**
     * Migrate user metadata to GUN registry (public metadata only)
     */
    async migrateUsers() {
        console.log('👥 Starting user metadata migration...');
        console.log('🔒 Note: Only public metadata will be synced (email, publicKey, status)');
        console.log('🔑 Sensitive data (passwords, private keys) must be migrated manually');
        
        try {
            // Get all users from Elasticsearch
            const users = await this.getAllUsers();
            this.stats.totalUsers = users.length;
            
            console.log(`📊 Found ${users.length} users to migrate`);
            
            for (const user of users) {
                await this.processUser(user);
            }
            
            this.printUserMigrationSummary();
            return this.stats;
            
        } catch (error) {
            console.error('❌ User migration failed:', error);
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
     * Process a single user for migration
     */
    async processUser(userData) {
        try {
            const user = userData.source;
            const userSoul = `oip:user:${user.email.toLowerCase()}`;
            
            // Create public metadata (DO NOT include sensitive data)
            const publicUserData = {
                email: user.email,
                publicKey: user.publicKey,
                createdAt: user.createdAt,
                waitlistStatus: user.waitlistStatus,
                subscriptionStatus: user.subscriptionStatus,
                lastUpdated: new Date().toISOString(),
                // SECURITY: DO NOT include passwordHash, encryptedPrivateKey, encryptedMnemonic
                syncedFromNode: this.registry.nodeId
            };
            
            if (this.dryRun) {
                console.log(`🔍 [DRY RUN] Would register user: ${user.email}`);
                this.stats.usersRegistered++;
                return;
            }
            
            // Store in GUN with encryption
            await this.registry.gunHelper.putRecord(publicUserData, userSoul, { encrypt: true });
            
            // Add to global user registry
            await this.addToUserRegistry(user.email, userSoul);
            
            this.stats.usersRegistered++;
            console.log(`✅ Registered user metadata: ${user.email}`);
            
        } catch (error) {
            console.error(`❌ Error processing user ${userData.source.email}:`, error);
            this.stats.errors++;
        }
    }
    
    /**
     * Add user to global registry
     */
    async addToUserRegistry(email, userSoul) {
        try {
            const registryEntry = {
                [`user:${email.toLowerCase()}`]: userSoul,
                lastUpdated: new Date().toISOString()
            };
            
            await this.registry.gunHelper.putRecord(registryEntry, this.userRegistrySoul);
            
        } catch (error) {
            console.error('❌ Error adding user to registry:', error);
        }
    }
    
    /**
     * Print user migration summary
     */
    printUserMigrationSummary() {
        console.log('\n👥 User Migration Summary:');
        console.log('=========================');
        console.log(`Total users found: ${this.stats.totalUsers}`);
        console.log(`User metadata registered: ${this.stats.usersRegistered}`);
        console.log(`Errors encountered: ${this.stats.errors}`);
        
        if (this.dryRun) {
            console.log('\n🔍 This was a DRY RUN - no actual changes were made');
        } else {
            console.log('\n✅ User metadata migration completed!');
            console.log('🔑 Users will need to re-authenticate on new nodes to access their private keys');
        }
    }
}

// Main execution
async function main() {
    const args = minimist(process.argv.slice(2));
    const options = {
        dryRun: args['dry-run'] || args.dryRun || false,
        force: args.force || false,
        usersOnly: args['users-only'] || args.usersOnly || false,
        recordsOnly: args['records-only'] || args.recordsOnly || false
    };
    
    console.log('🚀 OIP GUN Migration Tool');
    console.log('==========================');
    console.log('Options:', options);
    console.log('');
    
    try {
        if (!options.usersOnly) {
            // Migrate GUN records
            const recordMigration = new ExistingRecordMigration(options);
            await recordMigration.migrate();
        }
        
        if (!options.recordsOnly) {
            // Migrate user metadata
            const userMigration = new UserMigrationService(options);
            await userMigration.migrateUsers();
        }
        
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

module.exports = { ExistingRecordMigration, UserMigrationService };
