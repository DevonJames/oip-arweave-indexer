const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Helper function to find wallet file in both Docker and local development environments
 * @returns {string} The correct path to the wallet file
 */
const getWalletFilePath = () => {
    const walletFile = process.env.WALLET_FILE;
    if (!walletFile) {
        throw new Error('WALLET_FILE environment variable is not set');
    }
    
    // Try Docker absolute path first
    const dockerPath = path.resolve('/usr/src/app', walletFile);
    if (fs.existsSync(dockerPath)) {
        return dockerPath;
    }
    
    // Try local development relative path
    const localPath = path.resolve(process.cwd(), walletFile);
    if (fs.existsSync(localPath)) {
        return localPath;
    }
    
    // Try just the environment variable as-is
    if (fs.existsSync(walletFile)) {
        return walletFile;
    }
    
    throw new Error(`Wallet file not found at any of these locations:\n- ${dockerPath}\n- ${localPath}\n- ${walletFile}`);
};
const { ArweaveSigner } = require('arbundles');
const { TurboFactory } = require('@ardrive/turbo-sdk');
const arweave = require('arweave');
const {crypto, createHash} = require('crypto');
const jwt = require('jsonwebtoken');
const base64url = require('base64url');
const templatesConfig = require('../config/templates.config.js');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
dotenv.config();

const getTurboArweave = async () => {
    const walletFileLocation = getWalletFilePath();
    const key = JSON.parse(fs.readFileSync(walletFileLocation).toString());
    
    console.log('Initializing Turbo SDK...');
    console.log('Environment check:');
    console.log('- TURBO_API:', process.env.TURBO_API || 'not set');
    console.log('- TURBO_LOGIN:', process.env.TURBO_LOGIN || 'not set'); 
    console.log('- NODE_ENV:', process.env.NODE_ENV || 'not set');
    
    try {
        const turbo = TurboFactory.authenticated({ 
            privateKey: key
        });
        console.log('Turbo SDK initialized successfully');
        return turbo;
    } catch (error) {
        console.error('Error initializing Turbo SDK:', error);
        throw error;
    }
};

const getFileInfo = () => {
    const filename = path.basename(__filename);
    const directory = path.basename(__dirname);
    return `${directory}/${filename}`;
};

const getLineNumber = () => {
    const e = new Error();
    const stack = e.stack.split('\n');
    const lineInfo = stack[2].trim();
    const lineNumber = lineInfo.split(':')[1];
    return lineNumber;
};

const validateTemplateFields = (fieldsJson) => {
    try {
        const fields = JSON.parse(fieldsJson);
        let lastKeyWasEnum = false;

        for (const key in fields) {
            if (key.startsWith("index_")) {
                continue;
            }

            if (lastKeyWasEnum && key.endsWith("Values")) {
                lastKeyWasEnum = false;
                continue;
            }

            const expectedIndexKey = `index_${key}`;

            if (!(expectedIndexKey in fields)) {
                console.log(`Missing index for: ${key}`);
                return false;
            }

            lastKeyWasEnum = fields[key] === "enum";
        }

        return true;
    } catch (error) {
        console.error('Error validating template fields:', error);
        return false;
    }
};

const verifySignature = async (message, signatureBase64, publicKey, creatorAddress = null) => {
    // console.log('Verifying signature... for creatorAddress', creatorAddress, 'publicKey', publicKey);
    if (publicKey === null && creatorAddress !== null) {
        const creatorData = await searchCreatorByAddress(creatorAddress);
        if (creatorData) {
            publicKey = creatorData.creatorPublicKey;
        } else {
            return false;
        }
    }

    const messageData = new TextEncoder().encode(message);
    const signature = Buffer.from(signatureBase64, 'base64');
    const isVerified = await ArweaveSigner.verify(publicKey, messageData, signature);
    return isVerified;
};

const signMessage = async (data) => {
    const walletPath = getWalletFilePath();
    const jwk = JSON.parse(fs.readFileSync(walletPath));
    const myPublicKey = jwk.n;
    const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest());
    const signatureObject = await arweave.crypto.sign(jwk, data);
    const signatureBase64 = Buffer.from(signatureObject).toString('base64');
    return signatureBase64;
};

const isValidDid = (did) => {
    return /^did:arweave:[a-zA-Z0-9_-]{43}$/.test(did);
};

const isValidTxId = (txid) => {
    return /^[a-zA-Z0-9_-]{43}$/.test(txid);
};

const txidToDid = (txid) => {
    if (!isValidTxId(txid)) {
        throw new Error('Invalid transaction ID format');
    }
    return `did:arweave:${txid}`;
};

const didToTxid = (did) => {
    if (!isValidDid(did)) {
        throw new Error('Invalid DID format');
    }
    return did.split(':')[2];
};

const loadRemapTemplates = async () => {
    const remapTemplates = {};
    const remapTemplatesDir = path.resolve(__dirname, '../remapTemplates');

    const files = fs.readdirSync(remapTemplatesDir);

    for (const file of files) {
        if (path.extname(file) === '.json') {
            const templateName = path.basename(file, '.json');
            const templatePath = path.join(remapTemplatesDir, file);
            const templateContent = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
            remapTemplates[templateName] = templateContent;
        }
    }

    return remapTemplates;
};

const getTemplateTxidByName = (templateName) => {
    const templateConfigTxid = templatesConfig.defaultTemplates[templateName];
    return templateConfigTxid ? templateConfigTxid : null;
};

const resolveRecords = async (record, resolveDepth, recordsInDB, resolveNamesOnly = false) => {
    if (resolveDepth === 0 || !record) {
        return record;
    }

    if (!record.data || typeof record.data !== 'object') {
        console.error(getFileInfo(), getLineNumber(), 'record.data is not an object:', record.data);
        return record;
    }

    // First resolve all DIDs to names/records
    for (const category of Object.keys(record.data)) {
        const properties = record.data[category];
        for (const key of Object.keys(properties)) {
            if (typeof properties[key] === 'string' && properties[key].startsWith('did:')) {
                const refRecord = recordsInDB.find(record => record.oip.didTx === properties[key]);
                if (refRecord) {
                    if (resolveNamesOnly) {
                        // Only return the name from the basic data
                        const name = refRecord.data?.basic?.name || properties[key]; // fallback to DID if no name found
                        properties[key] = name;
                    } else {
                        properties[key] = await resolveRecords(refRecord, resolveDepth - 1, recordsInDB, resolveNamesOnly);
                    }
                }
            } else if (Array.isArray(properties[key])) {
                for (let i = 0; i < properties[key].length; i++) {
                    if (typeof properties[key][i] === 'string' && properties[key][i].startsWith('did:')) {
                        const refRecord = recordsInDB.find(record => record.oip.didTx === properties[key][i]);
                        if (refRecord) {
                            if (resolveNamesOnly) {
                                // Only return the name from the basic data
                                const name = refRecord.data?.basic?.name || properties[key][i]; // fallback to DID if no name found
                                properties[key][i] = name;
                            } else {
                                properties[key][i] = await resolveRecords(refRecord, resolveDepth - 1, recordsInDB, resolveNamesOnly);
                            }
                        }
                    }
                }
            }
        }
    }

    // AFTER DID resolution, handle special recipe merging for resolveNamesOnly
    if (resolveNamesOnly && record.data.recipe) {
        const recipeData = record.data.recipe;
        
        // If this is a recipe with ingredient and ingredient_comment fields
        if (Array.isArray(recipeData.ingredient) && Array.isArray(recipeData.ingredient_comment)) {
            // Merge ingredient names with their comments
            const mergedIngredients = recipeData.ingredient.map((ingredient, index) => {
                const comment = recipeData.ingredient_comment[index] || '';
                
                // If there's a comment, merge it with the ingredient name
                if (comment && comment.trim()) {
                    // Handle different comment patterns
                    if (comment.includes('ground') && !ingredient.includes('ground')) {
                        // For "ground" comments, prepend to the ingredient name
                        return `${comment} ${ingredient}`;
                    } else if (comment.includes('virgin') && ingredient.includes('oil')) {
                        // For "extra virgin" comments with oil, prepend and handle "divided"
                        const parts = comment.split(' ');
                        const virginParts = parts.filter(p => p.includes('virgin') || p.includes('extra'));
                        const otherParts = parts.filter(p => !p.includes('virgin') && !p.includes('extra'));
                        
                        let result = `${virginParts.join(' ')} ${ingredient}`;
                        if (otherParts.length > 0) {
                            result += `, ${otherParts.join(' ')}`;
                        }
                        return result;
                    } else if (comment.includes('boneless') || comment.includes('skinless')) {
                        // For meat descriptions, prepend to ingredient name
                        return `${comment} ${ingredient}`;
                    } else {
                        // For other comments (like "minced", "juiced", "halved and thinly sliced"), append with comma
                        return `${ingredient}, ${comment}`;
                    }
                }
                
                // If no comment, return the ingredient as-is
                return ingredient;
            });
            
            // Replace the ingredient array with the merged version
            recipeData.ingredient = mergedIngredients;
        }
    }

    return record;
};

// Middleware to verify the JWT token
const authenticateToken = (req, res, next) => {
    console.log('Authenticating token...', req.headers, req.body, req.user);
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    console.log('token:', token);

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        console.error('Invalid token:', error);
        return res.status(403).json({ error: 'Invalid token' });
    }
};

let remapTemplatesPromise = loadRemapTemplates();

module.exports = {
    getTurboArweave,
    verifySignature,
    signMessage,
    txidToDid,
    didToTxid,
    resolveRecords,
    validateTemplateFields,
    getTemplateTxidByName,
    getLineNumber,
    getFileInfo,
    loadRemapTemplates,
    authenticateToken,
    isValidDid,
    isValidTxId,
    getWalletFilePath
};