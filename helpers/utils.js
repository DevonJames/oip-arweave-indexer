const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { ArweaveSigner } = require('arbundles');
const Irys = require('@irys/sdk');
const arweave = require('arweave');
const {crypto, createHash} = require('crypto');
const jwt = require('jsonwebtoken');
const base64url = require('base64url');
const templatesConfig = require('../config/templates.config.js');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
dotenv.config();

const getIrysArweave = async () => {
    const network = "mainnet";
    const token = "arweave";
    const walletFileLocation = process.env.WALLET_FILE;
    const key = JSON.parse(fs.readFileSync(walletFileLocation).toString());
    const irys = new Irys({ network, token, key });
    return irys;
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
    console.log('\n=== SIGN MESSAGE FUNCTION START ===');
    console.log('INPUT DATA TO SIGN:', data);
    console.log('INPUT DATA LENGTH:', data.length);
    console.log('INPUT DATA TYPE:', typeof data);
    
    const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));
    const myPublicKey = jwk.n;
    const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest());
    console.log('SIGNER ADDRESS:', myAddress);
    console.log('SIGNER PUBLIC KEY (first 50 chars):', myPublicKey.substring(0, 50) + '...');
    
    console.log('ABOUT TO CALL arweave.crypto.sign...');
    const signatureObject = await arweave.crypto.sign(jwk, data);
    console.log('SIGNATURE OBJECT TYPE:', typeof signatureObject);
    console.log('SIGNATURE OBJECT LENGTH:', signatureObject.length);
    
    const signatureBase64 = Buffer.from(signatureObject).toString('base64');
    console.log('FINAL SIGNATURE BASE64:', signatureBase64);
    console.log('FINAL SIGNATURE LENGTH:', signatureBase64.length);
    console.log('=== SIGN MESSAGE FUNCTION END ===\n');
    
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

const resolveRecords = async (record, resolveDepth, recordsInDB) => {
    if (resolveDepth === 0 || !record) {
        return record;
    }

    if (!record.data || typeof record.data !== 'object') {
        console.error(getFileInfo(), getLineNumber(), 'record.data is not an object:', record.data);
        return record;
    }

    for (const category of Object.keys(record.data)) {
        const properties = record.data[category];
        for (const key of Object.keys(properties)) {
            if (typeof properties[key] === 'string' && properties[key].startsWith('did:')) {
                const refRecord = recordsInDB.find(record => record.oip.didTx === properties[key]);
                if (refRecord) {
                    properties[key] = await resolveRecords(refRecord, resolveDepth - 1, recordsInDB);
                }
            } else if (Array.isArray(properties[key])) {
                for (let i = 0; i < properties[key].length; i++) {
                    if (typeof properties[key][i] === 'string' && properties[key][i].startsWith('did:')) {
                        const refRecord = recordsInDB.find(record => record.oip.didTx === properties[key][i]);
                        if (refRecord) {
                            properties[key][i] = await resolveRecords(refRecord, resolveDepth - 1, recordsInDB);
                        }
                    }
                }
            }
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
    getIrysArweave,
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
    isValidTxId
};