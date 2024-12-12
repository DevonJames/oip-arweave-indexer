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
    const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));
    const myPublicKey = jwk.n;
    const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest());
    const signatureObject = await arweave.crypto.sign(jwk, data);
    const signatureBase64 = Buffer.from(signatureObject).toString('base64');
    return signatureBase64;
};

const txidToDid = (txid) => {
    return `did:arweave:${txid}`;
};

const didToTxid = (did) => {
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
    // console.log('111 record:', record);
    // console.log(getFileInfo(), getLineNumber(), 'Resolving record:', record, 'with resolveDepth:', resolveDepth, 'qty of records in db', recordsInDB.length);
    // console.log(
    //     getFileInfo(),
    //     getLineNumber(),
    //     'Resolving record:',
    //     record,
    //     'with resolveDepth:',
    //     resolveDepth,
    //     'qty of records in db:',
    //     recordsInDB.length,
    //     'list of didTx values:',
    //     Array.isArray(recordsInDB) ? recordsInDB.map(record => record.oip.didTx) : 'recordsInDB is not an array' // Check if recordsInDB is an array before mapping
    // );

    if (resolveDepth === 0 || !record) {
        return record;
    }

    if (!Array.isArray(record.data)) {
        console.error(getFileInfo(), getLineNumber(), 'record.data is not an array:', record.data);
        return record;
    }

    for (const item of record.data) {
        // console.log(getFileInfo(), getLineNumber(), 'Checking record.data:', record.data);
        for (const category of Object.keys(item)) {
            const properties = item[category];
            for (const key of Object.keys(properties)) {
                // console.log(getFileInfo(), getLineNumber(), `Checking key ${key} with value ${properties[key]}`);
                if (typeof properties[key] === 'string' && properties[key].startsWith('did:')) {
                    // console.log(getFileInfo(), getLineNumber(), `Resolving reference ${properties[key]} for key ${key}`,'record');
                    const refRecord = recordsInDB.find(record => record.oip.didTx === properties[key]);
                    // console.log(getFileInfo(), getLineNumber(), `Found refRecord: ${refRecord}`);
                    if (refRecord) {
                        properties[key] = await resolveRecords(refRecord, resolveDepth - 1, recordsInDB);
                        // console.log(getFileInfo(), getLineNumber(), `Resolved reference ${properties[key]} for key ${key}`);
                    }
                } else if (Array.isArray(properties[key])) {
                    // console.log(getFileInfo(), getLineNumber(), `Checking array ${key} with values ${properties[key]}`);
                    for (let i = 0; i < properties[key].length; i++) {
                        // console.log(getFileInfo(), getLineNumber(), `Checking array value ${properties[key][i]}`);
                        if (typeof properties[key][i] === 'string' && properties[key][i].startsWith('did:')) {
                            // console.log(getFileInfo(), getLineNumber(), {recordsInDB});
                            const refRecord = recordsInDB.find(record => record.oip.didTx === properties[key][i]);
                            if (refRecord) {
                                properties[key][i] = await resolveRecords(refRecord, resolveDepth - 1, recordsInDB);
                                // console.log(getFileInfo(), getLineNumber(), `Resolved array reference ${properties[key][i]} for key ${key}`);
                            }
                        }
                    }
                }
            }
        }
    }
    return record;
};

// Middleware to verify the JWT token
function authenticateToken(req, res, next) {
    console.log('Authenticating token...', req.headers);
    const token = req.headers['authorization']?.split(' ')[1];
    console.log('token:', token);
    if (!token) {
        console.log('No token provided');
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log('Invalid token:', err);
            return res.status(403).json({ error: 'Invalid token.' });
        }
        req.user = decoded; // Attach the decoded token data, including userId, to the request

        // req.user = user; // Store the user info in the request object
        console.log('Token authenticated');
        next(); // Proceed to the next middleware or route
    });
}



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
    authenticateToken
};