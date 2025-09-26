const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc);
const { elasticClient, ensureUserIndexExists, verifyAdmin } = require('../helpers/elasticsearch');
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware

// JWT secret (should be stored in environment variables in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
const router = express.Router();
const REGISTRATION_LIMIT = process.env.REGISTRATION_LIMIT

// Helper functions for salt encryption/decryption
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

function decryptSaltWithPassword(encryptedSaltData, password) {
    try {
        const saltData = JSON.parse(encryptedSaltData);
        
        // Generate decryption key from password
        const key = crypto.pbkdf2Sync(password, 'oip-salt-encryption', 100000, 32, 'sha256');
        const iv = Buffer.from(saltData.iv, 'base64');
        const authTag = Buffer.from(saltData.authTag, 'base64');
        const encrypted = Buffer.from(saltData.encrypted, 'base64');
        
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
        
    } catch (error) {
        throw new Error(`Failed to decrypt GUN salt: ${error.message}`);
    }
}

// Join Waitlist Endpoint
router.post('/joinWaitlist', async (req, res) => {
    const { email } = req.body;

    try {
        // Ensure the users index exists
        await ensureUserIndexExists();

        // Check if the user is already on the waitlist or registered
        const existingUser = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    term: { 
                        email: {
                            value: email.toLowerCase() // Ensure case-insensitive matching
                        }
                    }
                }
            }
        });

        if (existingUser.hits.hits.length > 0) {
            const userStatus = existingUser.hits.hits[0]._source.waitlistStatus || 'registered';
            return res.status(400).json({ 
                success: false, // Add this line
                error: `You are already ${userStatus === 'pending' ? 'on the waitlist' : 'registered'}.` 
            });
        }

        // Check the current registered user count
        const registeredCount = await elasticClient.count({
            index: 'users',
            body: {
                query: {
                    match: { waitlistStatus: 'registered' }
                }
            }
        });

        if (registeredCount.count < REGISTRATION_LIMIT) {
            return res.status(400).json({ 
                success: false, // Add this line
                error: 'Registration is still open. Please register directly.' 
            });
        }

        // Add user to the waitlist with status 'pending'
        await elasticClient.index({
            index: 'users',
            body: {
                email: email,
                waitlistStatus: 'pending',
                requestDate: new Date()
            },
            refresh: 'wait_for'
        });

        return res.status(201).json({ message: 'Successfully added to the waitlist!' });
    } catch (error) {
        console.error('Error adding to waitlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Register endpoint
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('Registering user...', email);

        // Ensure the users index exists
        await ensureUserIndexExists();

        // Check if the user already exists
        const existingUser = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    term: { 
                        email: {
                            value: email.toLowerCase() // Normalize to lowercase for consistency
                        }
                    }
                }
            }
        });

        if (existingUser.hits.hits.length > 0) {
            const userStatus = existingUser.hits.hits[0]._source.waitlistStatus || 'registered';

            // If the user is already registered, inform them
            if (userStatus === 'registered') {
                return res.status(400).json({
                    success: false,
                    error: 'User is already registered.'
                });
            }
            // If the user is on the waitlist and not yet approved, restrict registration
            if (userStatus === 'pending') {
                return res.status(403).json({
                    success: false,
                    error: 'You are on the waitlist and not yet approved for registration.'
                });
            }
        }

        // Check the current registered user count
        const registeredCount = await elasticClient.count({
            index: 'users',
            body: {
                query: {
                    match: { waitlistStatus: 'registered' }
                }
            }
        });

        console.log('Registered count...', registeredCount.count);

        // Allow direct registration if the registered user count is below 50
        if (registeredCount.count < REGISTRATION_LIMIT) {
            console.log('Registering user...', email);
            return await completeRegistration(null, password, email, res);
        }

        // If the registered count is REGISTRATION_LIMIT or more, check if the user is approved on the waitlist
        if (existingUser.hits.hits.length > 0 && existingUser.hits.hits[0]._source.waitlistStatus === 'approved') {
            console.log('Registering user...', existingUser.hits.hits[0]?._id);
            return await completeRegistration(existingUser.hits.hits[0]?._id, password, email, res);
        } else {
            // If not approved, direct them to join the waitlist
            return res.status(403).json({
                success: false,
                error: 'Registration limit reached. Please join the waitlist first.'
            });
        }
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

async function completeRegistration(userId, password, email, res) {
    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // NEW: Generate HD wallet for user
        console.log('🔑 Generating HD wallet for user:', email);
        const mnemonic = bip39.generateMnemonic(); // 12-word seed phrase
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const masterKey = bip32.fromSeed(seed);
        
        // Derive user's signing key (m/44'/0'/0'/0/0)
        const userKey = masterKey.derivePath("m/44'/0'/0'/0/0");
        
        // Ensure public key is properly converted to hex string
        const publicKeyBuffer = userKey.publicKey;
        const publicKey = Buffer.isBuffer(publicKeyBuffer) 
            ? publicKeyBuffer.toString('hex')
            : Array.from(publicKeyBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const privateKey = userKey.privateKey.toString('hex');
        
        // Generate user-specific encryption salt for GUN records
        const gunEncryptionSalt = crypto.randomBytes(32).toString('hex');
        
        // Encrypt private key and mnemonic with user's password
        const encryptedPrivateKey = crypto.pbkdf2Sync(privateKey, password, 100000, 32, 'sha256').toString('hex');
        const encryptedMnemonic = crypto.pbkdf2Sync(mnemonic, password, 100000, 32, 'sha256').toString('hex');
        
        // Encrypt the GUN encryption salt with user's password using AES-256-GCM
        const encryptedGunSalt = encryptSaltWithPassword(gunEncryptionSalt, password);
        
        console.log('🔑 Generated user public key (hex):', publicKey.slice(0, 20) + '...');
        console.log('🔑 Generated user GUN encryption salt:', gunEncryptionSalt.slice(0, 8) + '...');
        console.log('🔑 Public key type:', typeof publicKey, 'length:', publicKey.length);
        
        // If userId is undefined, create a new user document; otherwise, update existing document
        if (userId) {
        // Update user record with registration details
            await elasticClient.update({
                index: 'users',
                id: userId, // Use userId passed as a parameter
                body: {
                    doc: {
                        passwordHash: passwordHash,
                        // NEW: User cryptographic identity
                        publicKey: publicKey,
                        encryptedPrivateKey: encryptedPrivateKey, // Encrypted with user's password
                        encryptedMnemonic: encryptedMnemonic, // Encrypted mnemonic
                        encryptedGunSalt: encryptedGunSalt, // NEW: Encrypted GUN encryption salt
                        keyDerivationPath: "m/44'/0'/0'/0/0",
                        createdAt: new Date(),
                        waitlistStatus: 'registered',
                        subscriptionStatus: 'inactive', // Default subscription status
                        paymentMethod: null // Initially, no payment method
                    }
                },
                refresh: 'wait_for'
            });
        } else {
            // Handle case where user needs to be created because `userId` is undefined
            const newUser = await elasticClient.index({
                index: 'users',
                body: {
                    email: email,
                    passwordHash: passwordHash,
                    // NEW: User cryptographic identity
                    publicKey: publicKey,
                    encryptedPrivateKey: encryptedPrivateKey, // Encrypted with user's password
                    encryptedMnemonic: encryptedMnemonic, // Encrypted mnemonic
                    encryptedGunSalt: encryptedGunSalt, // NEW: Encrypted GUN encryption salt
                    keyDerivationPath: "m/44'/0'/0'/0/0",
                    createdAt: new Date(),
                    waitlistStatus: 'registered',
                    subscriptionStatus: 'inactive', // Default subscription status
                    paymentMethod: null // Initially, no payment method
                },
                refresh: 'wait_for'
            });
            userId = newUser._id; // Set the new user ID
        }

        // Create JWT token for the new user - include user's public key
        const token = jwt.sign({ 
            userId, 
            email, 
            publicKey: publicKey, // NEW: Include user's public key in JWT
            isAdmin: false 
        }, JWT_SECRET, { expiresIn: '45d' });

        return res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token, // Return the JWT token
            publicKey: publicKey, // NEW: Return public key for client awareness
            mnemonic: mnemonic // NEW: Return mnemonic for user to backup and import on other nodes
        });
    } catch (error) {
        console.error('Error completing registration:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


// Create a more robust search for users by email
async function findUserByEmail(email) {
    console.log(`Searching for user with email: "${email.toLowerCase()}"`);
    
    // Try an exact match first
    const exactMatchResult = await elasticClient.search({
        index: 'users',
        body: {
            query: {
                term: { 
                    email: {
                        value: email.toLowerCase()
                    }
                }
            }
        }
    });
    
    if (exactMatchResult.hits.hits.length > 0) {
        console.log('Found user with exact match');
        return exactMatchResult;
    }
    
    // If exact match fails, try a match query
    console.log('Exact match failed, trying fuzzy match');
    const fuzzyMatchResult = await elasticClient.search({
        index: 'users',
        body: {
            query: {
                match: {
                    email: email.toLowerCase()
                }
            }
        }
    });
    
    if (fuzzyMatchResult.hits.hits.length > 0) {
        console.log('Found user with fuzzy match');
        return fuzzyMatchResult;
    }
    
    // If all else fails, try a wildcard query
    console.log('Fuzzy match failed, trying wildcard match');
    const wildcardMatchResult = await elasticClient.search({
        index: 'users',
        body: {
            query: {
                wildcard: {
                    email: `*${email.toLowerCase()}*`
                }
            }
        }
    });
    
    console.log(`Wildcard search results: ${wildcardMatchResult.hits.hits.length} hits`);
    return wildcardMatchResult;
}

// async function completeRegistration(userId, password, email, res) {
//     try {
//         const saltRounds = 10;
//         const passwordHash = await bcrypt.hash(password, saltRounds);
//         // If userId is undefined, create a new user document; otherwise, update existing document
//         if (userId === null) {
//             // Handle case where user needs to be created because `userId` is undefined
//             const newUser = await elasticClient.index({
//                 index: 'users',
//                 body: {
//                     email: email,
//                     passwordHash: passwordHash,
//                     createdAt: new Date(),
//                     waitlistStatus: 'registered',
//                     subscriptionStatus: 'inactive', // Default subscription status
//                     paymentMethod: null // Initially, no payment method
//                 },
//                 refresh: 'wait_for'
//             });
//             userId = newUser._id; // Set the new user ID
//         } else {
//         // Update user record with registration details
//             await elasticClient.update({
//                 index: 'users',
//                 id: userId, // Use userId passed as a parameter
//                 body: {
//                     doc: {
//                         passwordHash: passwordHash,
//                         createdAt: new Date(),
//                         waitlistStatus: 'registered',
//                         subscriptionStatus: 'inactive', // Default subscription status
//                         paymentMethod: null // Initially, no payment method
//                     }
//                 },
//                 refresh: 'wait_for'
//             });
//         }


//         // Create JWT token for the new user
//         const userId = searchResult.hits.hits[0]._id; // Retrieve the Elasticsearch _id for the user

//         const token = jwt.sign({ userId, email: user.email, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '45d' });

//         return res.status(201).json({
//             success: true,
//             message: 'User registered successfully',
//             token // Return the JWT token
//         });
//     } catch (error) {
//         console.error('Error completing registration:', error);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// }

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Search for the user in Elasticsearch
        // const exactMatchResult = await elasticClient.search({
        //     index: 'users',
        //     body: {
        //         query: {
        //             term: { 
        //                 email: {
        //                     value: email.toLowerCase() // Ensure case-insensitive matching
        //                 }
        //             }
        //         }
        //     }
        // });

        // if (exactMatchResult.hits.hits.length > 0) {
        //     console.log('Found user with exact match');
        //     return exactMatchResult;
        // }

        // // If exact match fails, try a match query
        // console.log('Exact match failed, trying fuzzy match');
        // const fuzzyMatchResult = await elasticClient.search({
        //     index: 'users',
        //     body: {
        //         query: {
        //             match: {
        //                 email: email.toLowerCase()
        //             }
        //         }
        //     }
        // });
        
        // if (fuzzyMatchResult.hits.hits.length > 0) {
        //     console.log('Found user with fuzzy match');
        //     return fuzzyMatchResult;
        // }


        // if (searchResult.hits.hits.length === 0) {
        //     return res.status(400).json({ 
        //         success: false, // Add this line
        //         error: 'User not found'
        //      });
        // }

        const searchResult = await findUserByEmail(email);

        // console.log('Search result...', searchResult.hits.hits[0]._source, searchResult.hits.hits[1]._source, searchResult.hits.hits[2]._source);

        const user = searchResult.hits.hits[0]._source;
        const userId = searchResult.hits.hits[0]._id;

        // Compare the provided password with the stored hash
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            return res.status(400).json({ 
                success: false, // Add this line
                error: 'Invalid password' 
            });
        }

        // Check if user needs GUN encryption salt (for existing users)
        if (!user.encryptedGunSalt) {
            console.log('🔑 Generating GUN encryption salt for existing user during login:', user.email);
            
            try {
                // Generate new salt
                const gunEncryptionSalt = crypto.randomBytes(32).toString('hex');
                const encryptedGunSalt = encryptSaltWithPassword(gunEncryptionSalt, password);
                
                // Update user record with new salt
                await elasticClient.update({
                    index: 'users',
                    id: userId,
                    body: {
                        doc: {
                            encryptedGunSalt: encryptedGunSalt,
                            gunSaltGeneratedAt: new Date().toISOString()
                        }
                    },
                    refresh: 'wait_for'
                });
                
                console.log('✅ Generated and stored GUN encryption salt for existing user');
                
            } catch (error) {
                console.error('❌ Failed to generate GUN salt for existing user:', error);
                // Don't fail login for salt generation issues
            }
        } else {
            // Check if this is a migration placeholder that needs proper encryption
            try {
                const saltData = JSON.parse(user.encryptedGunSalt);
                if (saltData.isMigrationPlaceholder) {
                    console.log('🔄 Converting migration placeholder salt to properly encrypted salt:', user.email);
                    
                    const plaintextSalt = saltData.plaintextSalt;
                    const properlyEncryptedSalt = encryptSaltWithPassword(plaintextSalt, password);
                    
                    // Update with properly encrypted salt
                    await elasticClient.update({
                        index: 'users',
                        id: userId,
                        body: {
                            doc: {
                                encryptedGunSalt: properlyEncryptedSalt,
                                gunSaltUpgradedAt: new Date().toISOString()
                            }
                        },
                        refresh: 'wait_for'
                    });
                    
                    console.log('✅ Upgraded migration placeholder to properly encrypted salt');
                }
            } catch (error) {
                // If parsing fails, it's probably already properly encrypted
                console.log('🔑 User already has properly encrypted GUN salt');
            }
        }

        // Decrypt user's private key for organization processing
        let decryptedPrivateKey = null;
        try {
            if (user.encryptedPrivateKey) {
                decryptedPrivateKey = decryptPrivateKeyWithPassword(user.encryptedPrivateKey, password);
                console.log('🔑 Successfully decrypted user private key for organization processing');
            }
        } catch (error) {
            console.warn('⚠️ Could not decrypt private key for organization processing:', error.message);
        }

        // Process organization decryption queue if user owns organizations
        if (decryptedPrivateKey) {
            try {
                const { OrganizationDecryptionQueue } = require('../helpers/organizationDecryptionQueue');
                const decryptQueue = new OrganizationDecryptionQueue();
                await decryptQueue.processDecryptionQueue(user.publicKey, decryptedPrivateKey);
                console.log('✅ Processed organization decryption queue for user');
            } catch (orgError) {
                console.error('❌ Error processing organization decryption queue:', orgError);
                // Don't fail login for organization processing errors
            }
        }

        // Authentication successful - Create JWT token
        const token = jwt.sign({ 
            userId, 
            email: user.email, 
            publicKey: user.publicKey, // NEW: Include user's public key in JWT
            isAdmin: user.isAdmin 
        }, JWT_SECRET, { expiresIn: '45d' });
        
        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token, // Return the JWT token
            publicKey: user.publicKey // NEW: Return public key for client awareness
        });
    } catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reset Password endpoint
router.post('/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;

    try {
        // Search for the user by email
        const searchResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    term: { 
                        email: {
                            value: email.toLowerCase() // Ensure case-insensitive matching
                        }
                    }
                }
            }
        });

        if (searchResult.hits.hits.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const userId = searchResult.hits.hits[0]._id;
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);

        // Update the password in Elasticsearch
        await elasticClient.update({
            index: 'users',
            id: userId,
            body: {
                doc: { passwordHash: passwordHash }
            },
            refresh: 'wait_for'
        });

        return res.status(200).json({ success: true, message: 'Password reset successful' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// // Middleware to verify the JWT token
// function authenticateToken(req, res, next) {
//     const token = req.headers['authorization']?.split(' ')[1];

//     if (!token) {
//         return res.status(401).json({ error: 'Access denied. No token provided.' });
//     }

//     jwt.verify(token, JWT_SECRET, (err, user) => {
//         if (err) {
//             return res.status(403).json({ error: 'Invalid token.' });
//         }

//         req.user = user; // Store the user info in the request object
//         next(); // Proceed to the next middleware or route
//     });
// }

// Update subscription status (requires authentication)
router.put('/update-subscription', authenticateToken, async (req, res) => {
    try {
        const { subscriptionStatus } = req.body;
        const { email } = req.user;

        // Update the subscription status in Elasticsearch
        const searchResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    term: { 
                        email: {
                            value: email.toLowerCase() // Ensure case-insensitive matching
                        }
                    }
                }
            }
        });

        if (searchResult.hits.hits.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userId = searchResult.hits.hits[0]._id;

        await elasticClient.update({
            index: 'users',
            id: userId,
            body: {
                doc: { subscriptionStatus: subscriptionStatus }
            },
            refresh: 'wait_for'
        });

        return res.status(200).json({ message: 'Subscription status updated successfully' });
    } catch (error) {
        console.error('Error updating subscription status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update payment method (requires authentication)
router.put('/update-payment', authenticateToken, async (req, res) => {
    try {
        const { paymentMethod } = req.body;
        const { email } = req.user;

        // Update the payment method in Elasticsearch
        const searchResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    term: { 
                        email: {
                            value: email.toLowerCase() // Ensure case-insensitive matching
                        }
                    }
                }
            }
        });

        if (searchResult.hits.hits.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userId = searchResult.hits.hits[0]._id;

        await elasticClient.update({
            index: 'users',
            id: userId,
            body: {
                doc: { paymentMethod: paymentMethod }
            },
            refresh: 'wait_for'
        });

        return res.status(200).json({ message: 'Payment method updated successfully' });
    } catch (error) {
        console.error('Error updating payment method:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// Add "isAdmin" field to the user record for admin users
async function setAdminStatus(userId, isAdmin) {
    await elasticClient.update({
        index: 'users',
        id: userId,
        body: {
            doc: { isAdmin: isAdmin }
        },
        refresh: 'wait_for'
    });
}

// Route to fetch all registered users
router.get('/admin/users',  async (req, res) => {
    console.log("Authenticated Admin User:", req.user);
    try {
        // Check if the requester is an admin
        if (!req.user || !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Unauthorized access' });
        }

        // Search for all users with a status of 'registered'
        const users = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    match: { waitlistStatus: 'registered' }
                }
            }
        });

        const userList = users.hits.hits.map(hit => ({
            userId: hit._id,
            email: hit._source.email,
            subscriptionStatus: hit._source.subscriptionStatus,
            paymentStatus: hit._source.paymentMethod ? 'Active' : 'Inactive'
        }));

        res.status(200).json({ success: true, users: userList });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Route to update user status
// router.post('/admin/update-status',verifyAdmin, async (req, res) => {
router.post('/admin/update-status', async (req, res) => {
    try {
        if (!req.user || !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Unauthorized access' });
        }

        const { userId, field } = req.body;

        // Define the fields that can be toggled
        const allowedFields = ['subscriptionStatus', 'paymentStatus'];
        if (!allowedFields.includes(field)) {
            return res.status(400).json({ success: false, error: 'Invalid field' });
        }

        // Toggle the field value
        const user = await elasticClient.get({
            index: 'users',
            id: userId
        });

        const currentValue = user._source[field];
        const updatedValue = field === 'subscriptionStatus' ? (currentValue === 'inactive' ? 'active' : 'inactive') : (currentValue ? null : 'Active');

        // Update the user record
        await elasticClient.update({
            index: 'users',
            id: userId,
            body: {
                doc: { [field]: updatedValue }
            },
            refresh: 'wait_for'
        });

        res.status(200).json({ success: true, message: 'User status updated successfully' });
    } catch (error) {
        console.error('Error updating user status:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Protect this route to ensure only admins can access it
// router.post('/admin/reset', verifyAdmin, async (req, res) => {
router.post('/admin/reset', async (req, res) => {
    try {
        // Check if the requester is an admin
        if (!req.user || !req.user.isAdmin) {
            return res.status(403).json({ success: false, error: 'Unauthorized access' });
        }

        const { email, newPassword, newStatus } = req.body;

        // Check if the email, new password, or status is provided
        if (!email || (!newPassword && !newStatus)) {
            return res.status(400).json({ success: false, error: 'Email and at least one field to update are required' });
        }

        // Search for the user by email
        const existingUser = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    term: { 
                        email: {
                            value: email.toLowerCase() // Ensure case-insensitive matching
                        }
                    }
                }
            }
        });

        if (existingUser.hits.hits.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const userId = existingUser.hits.hits[0]._id;
        const updateFields = {};

        // If a new password is provided, hash it and add to update fields
        if (newPassword) {
            const saltRounds = 10;
            updateFields.passwordHash = await bcrypt.hash(newPassword, saltRounds);
        }

        // If a new status is provided, add it to update fields
        if (newStatus) {
            updateFields.waitlistStatus = newStatus;
        }

        // Update the user in Elasticsearch
        await elasticClient.update({
            index: 'users',
            id: userId,
            body: {
                doc: updateFields
            },
            refresh: 'wait_for'
        });

        res.status(200).json({
            success: true,
            message: 'User information updated successfully'
        });
    } catch (error) {
        console.error('Error resetting user information:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Function to get user's decrypted GUN encryption salt
async function getUserGunEncryptionSalt(userPublicKey, userPassword) {
    try {
        // Find user by public key
        const searchResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    term: { 
                        publicKey: {
                            value: userPublicKey
                        }
                    }
                }
            }
        });

        if (searchResult.hits.hits.length === 0) {
            throw new Error('User not found');
        }

        const user = searchResult.hits.hits[0]._source;
        
        // Check if user has encrypted GUN salt
        if (!user.encryptedGunSalt) {
            // Generate and store salt for existing users who don't have one
            console.log('🔑 Generating GUN salt for existing user:', user.email);
            const gunEncryptionSalt = crypto.randomBytes(32).toString('hex');
            const encryptedGunSalt = encryptSaltWithPassword(gunEncryptionSalt, userPassword);
            
            // Update user record with new salt
            await elasticClient.update({
                index: 'users',
                id: searchResult.hits.hits[0]._id,
                body: {
                    doc: {
                        encryptedGunSalt: encryptedGunSalt
                    }
                },
                refresh: 'wait_for'
            });
            
            return gunEncryptionSalt;
        }
        
        // Decrypt the stored salt using the user's password
        const decryptedSalt = decryptSaltWithPassword(user.encryptedGunSalt, userPassword);
        
        console.log('🔑 Retrieved GUN encryption salt for user:', user.email);
        return decryptedSalt;
        
    } catch (error) {
        console.error('Error getting user GUN encryption salt:', error);
        throw error;
    }
}

// Function to generate user-specific encryption key for GUN records
function generateUserEncryptionKey(userPublicKey, gunSalt) {
    // Combine user's public key with their unique salt
    const keyMaterial = userPublicKey + ':' + gunSalt;
    return crypto.pbkdf2Sync(keyMaterial, 'oip-gun-encryption', 100000, 32, 'sha256');
}

// Get user's mnemonic (for backup/import to other nodes)
router.get('/mnemonic', authenticateToken, async (req, res) => {
    try {
        const { password } = req.query;
        
        if (!password) {
            return res.status(400).json({ error: 'Password required to access mnemonic' });
        }
        
        const user = req.user;
        
        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        
        // Decrypt mnemonic
        const decryptedMnemonic = decryptMnemonicWithPassword(user.encryptedMnemonic, password);
        
        res.status(200).json({
            success: true,
            mnemonic: decryptedMnemonic,
            message: 'Save this mnemonic securely. You can use it to import your wallet on other OIP nodes.'
        });
        
    } catch (error) {
        console.error('Error retrieving mnemonic:', error);
        res.status(500).json({ error: 'Failed to retrieve mnemonic' });
    }
});

// Import wallet from mnemonic (for cross-node compatibility)
router.post('/import-wallet', async (req, res) => {
    try {
        const { email, password, mnemonic } = req.body;
        
        if (!email || !password || !mnemonic) {
            return res.status(400).json({ error: 'Email, password, and mnemonic are required' });
        }
        
        // Validate mnemonic
        if (!bip39.validateMnemonic(mnemonic)) {
            return res.status(400).json({ error: 'Invalid mnemonic phrase' });
        }
        
        // Check if user already exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists on this node' });
        }
        
        // Generate wallet from provided mnemonic
        console.log('🔑 Importing HD wallet for user:', email);
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const masterKey = bip32.fromSeed(seed);
        
        // Derive user's signing key (m/44'/0'/0'/0/0)
        const userKey = masterKey.derivePath("m/44'/0'/0'/0/0");
        
        // Ensure public key is properly converted to hex string
        const publicKeyBuffer = userKey.publicKey;
        const publicKey = Buffer.isBuffer(publicKeyBuffer) 
            ? publicKeyBuffer.toString('hex')
            : Array.from(publicKeyBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const privateKey = userKey.privateKey.toString('hex');
        
        // Generate user-specific encryption salt for GUN records
        const gunEncryptionSalt = crypto.randomBytes(32).toString('hex');
        
        // Hash password and encrypt wallet data
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const encryptedPrivateKey = crypto.pbkdf2Sync(privateKey, password, 100000, 32, 'sha256').toString('hex');
        const encryptedMnemonic = crypto.pbkdf2Sync(mnemonic, password, 100000, 32, 'sha256').toString('hex');
        const encryptedGunSalt = encryptSaltWithPassword(gunEncryptionSalt, password);
        
        // Create user record
        const newUser = await elasticClient.index({
            index: 'users',
            body: {
                email: email,
                passwordHash: passwordHash,
                publicKey: publicKey,
                encryptedPrivateKey: encryptedPrivateKey,
                encryptedMnemonic: encryptedMnemonic,
                encryptedGunSalt: encryptedGunSalt,
                keyDerivationPath: "m/44'/0'/0'/0/0",
                createdAt: new Date(),
                waitlistStatus: 'registered',
                subscriptionStatus: 'inactive',
                paymentMethod: null,
                importedWallet: true // Mark as imported
            },
            refresh: 'wait_for'
        });
        
        const userId = newUser._id;
        
        // Create JWT token
        const token = jwt.sign({ 
            userId, 
            email, 
            publicKey: publicKey,
            isAdmin: false 
        }, JWT_SECRET, { expiresIn: '45d' });
        
        res.status(201).json({
            success: true,
            message: 'Wallet imported successfully',
            token,
            publicKey: publicKey
        });
        
    } catch (error) {
        console.error('Error importing wallet:', error);
        res.status(500).json({ error: 'Failed to import wallet' });
    }
});

module.exports = { 
    router, 
    getUserGunEncryptionSalt, 
    generateUserEncryptionKey 
};