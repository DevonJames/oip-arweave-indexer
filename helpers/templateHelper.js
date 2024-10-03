const { create } = require('ipfs-http-client');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { crypto, createHash } = require('crypto');
const base64url = require('base64url');
const { signMessage, txidToDid, getIrysArweave, getTemplateTxidByName } = require('./utils');
const { searchTemplateByTxId, searchRecordInDB, getTemplatesInDB } = require('./elasticsearch');
// const templatesConfig = require('../config/templates.config');
// const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));

let WebTorrent;
async function initializeWebTorrent() {
  if (!WebTorrent) {
    WebTorrent = (await import('webtorrent')).default;
  }
}

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

function findMatchingString(mainString, arrayOfStrings) {
    const lowerMainString = mainString.toLowerCase();

    for (const str of arrayOfStrings) {
        const lowerStr = str.toLowerCase();

        if (lowerMainString.includes(lowerStr)) {
            return str; 
        }
    }
    return null;
}

const translateJSONtoOIPData = async (record, recordType) => {
    const { qtyTemplatesInDB } = await getTemplatesInDB()
    console.log('Translating JSON to OIP data:', record);
    const templates = Object.values(record);
    const templateNames = Object.keys(record);
    if (qtyTemplatesInDB === 0) {
        console.log('No templates found in DB, using hardcoded translation');
        const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));

        const myPublicKey = jwk.n
        const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest());

        const translatedData = [];

        if (record.creatorRegistration) {
            const creatorRegistration = record.creatorRegistration;
            const translatedCreatorRegistration = {
                "0": myAddress,
                "1": myPublicKey,
                "2": creatorRegistration.handle,
                "3": creatorRegistration.surname,
                "t": "creatorRegistration"
            };
            translatedData.push(translatedCreatorRegistration);
        }

        if (record.basic) {
            const basic = record.basic;
            const translatedBasic = {
                "0": basic.name,
                "3": 37, // index for english
                "t": "basic" // transaction ID placeholder
            };

            translatedData.push(translatedBasic);
        }
        return translatedData;
    }
    else {

        const convertedTemplates = [];
        for (let i = 0; i < templates.length; i++) {
            const template = templates[i];
            const templateName = templateNames[i];
            const templateTxid = getTemplateTxidByName(templateName);
            const json = { ...template };
            delete json.template;
            try {
                const template = await searchTemplateByTxId(templateTxid);
                if (template !== null) {
                    const fields = JSON.parse(template.data.fields);
                    const converted = {};
                    for (const key in json) {
                        const indexKey = `index_${key}`;
                        const fieldType = fields[key];
                        const fieldValuesKey = `${key}Values`;

                        if (fields[indexKey] !== undefined) {
                            if (fieldType === 'enum' && fields[fieldValuesKey]) {
                                const valueIndex = fields[fieldValuesKey].findIndex(val => {
                                    const inputCode = json[key].toLowerCase();
                                    const inputName = json[key].split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
                                    return val.code === inputCode || val.name === inputName;
                                });
                                if (valueIndex !== -1) {
                                    converted[fields[indexKey]] = valueIndex;
                                } else {
                                    console.log(`Value not found in enum values for key: ${key}`);
                                }
                            } else if (fieldType === 'dref') {
                                const subRecord = json[key];
                                console.log('th 108 Processing dref:', json[key], subRecord, 'type of json[key]:', typeof json[key], typeof subRecord, { key })

                                const templatesArray = Object.keys(json[key]);
                                recordType = findMatchingString(JSON.stringify(key), templatesArray)
                                console.log('th 130 recordType', recordType)
                                if (!recordType) {
                                    // check if there is only one template in the array
                                    if (templatesArray.length === 1) {
                                        recordType = templatesArray[0];
                                    } else {
                                        recordType = key;
                                    }
                                }
                                console.log('th 138 recordType', recordType)
                                const newRecord = await publishNewRecord(subRecord, recordType);
                                const dref = newRecord.didTx;
                                converted[fields[indexKey]] = dref;
                            } else if (fieldType === 'repeated dref') {
                                const subRecord = json[key][0];

                                console.log('th 113 Processing repeated dref for template:', template, json[key][0], subRecord, { key })
                                const templatesArray = Object.keys(json[key][0]);
                                recordType = findMatchingString(JSON.stringify(key)[0], templatesArray)
                                if (!recordType) {
                                    // check if there is only one template in the array
                                    if (templatesArray.length === 1) {
                                        recordType = templatesArray[0];
                                    } else {
                                        recordType = key;
                                        // console.log('Record type not found', { key });
                                    }
                                }

                                console.log('th 155 recordType', recordType)
                                const newRecord = await publishNewRecord(subRecord, recordType);
                                const dref = newRecord.didTx;
                                const repeatedDref = [dref];
                                converted[fields[indexKey]] = repeatedDref;
                            } else {
                                converted[fields[indexKey]] = json[key];
                            }
                        } else {
                            console.log('Field not found', { key });
                        }
                    }
                    converted.t = templateTxid;
                    convertedTemplates.push(converted);
                } else {
                    console.log('Template not found in Arweave yet', { templateTxid });
                }
            } catch (error) {
                console.error('Error processing template:', { templateName, error });
            }
        }
        return convertedTemplates;
    }
};

async function createAndSeedTorrent(videoFile) {
    try {
      // Initialize WebTorrent client
      await initializeWebTorrent();
  
      // Create the WebTorrent client
      const client = new WebTorrent();
      
      // Seed the video file
      const torrent = await new Promise((resolve, reject) => {
        client.seed(videoFile, (torrent) => {
        //   console.log(`Torrent created and seeded: ${torrent.magnetURI}`);
          resolve(torrent);
        });
      });
  
      // Handle client errors
      client.on('error', (err) => {
        console.error('Error with WebTorrent client:', err);
      });
  
      return torrent;
  
    } catch (error) {
      console.error('Error creating and seeding torrent:', error);
    }
}

// note: need to have new creator records derive their address and public key before publishing the registration record
async function publishNewRecord(record, recordType, publishFiles = false, addMediaToArweave = false, addMediaToIPFS = false, youtubeUrl = null) {
    console.log(getFileInfo(), getLineNumber(), 'record', { recordType }, record)
    try {
        let videoPath, thumbnailPath, videoInfo, arweaveAddress, ipfsAddress;

        if (publishFiles && youtubeUrl) {
            const result = await downloadAndProcessYouTubeVideo(youtubeUrl);
            videoPath = result.videoPath;
            thumbnailPath = result.thumbnailPath;
            videoInfo = result.videoInfo;

            if (addMediaToArweave) {
                const irys = await getIrysArweave();
                const arweaveReceipt = await irys.upload(fs.readFileSync(videoPath), { tags: [{ name: 'Content-Type', value: 'video/mp4' }] });
                arweaveAddress = `ar://${arweaveReceipt.id}`;
            }

            if (addMediaToIPFS) {
                ipfsAddress = await uploadToIPFS(videoPath);
            }
        }
        let recordData = '';
        console.log(getFileInfo(), getLineNumber(), 'Publishing new record:', { recordType }, record);
        if (record.delete) {
            let stringValue = JSON.stringify(record);
            recordData += stringValue;
        } else {

            if (recordType === 'creatorRegistration') {
                const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));
                const myPublicKey = jwk.n;
                const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest());
                record.creatorRegistration.publicKey = myPublicKey;
                record.creatorRegistration.address = myAddress;
            }
            const oipData = await translateJSONtoOIPData(record);
            let recordDataArray = [];

            oipData.forEach((record) => {
                let stringValue = JSON.stringify(record);
                recordDataArray.push(stringValue);
                recordData = `[${recordDataArray.join(',')}]`;
                console.log(getFileInfo(), getLineNumber(), 'recordData', recordData)
            });
        }
        const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));

        const myPublicKey = jwk.n;
        const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest()); 

        const irys = await getIrysArweave();
        const tags = [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Index-Method', value: 'OIP' },
            { name: 'Ver', value: '0.7.2' },
            { name: 'Type', value: 'Record' },
            { name: 'RecordType', value: `${recordType}` },
            { name: 'Creator', value: `${myAddress}` }
        ];

        const dataForSignature = JSON.stringify(tags) + recordData;
        const creatorSig = await signMessage(dataForSignature);
        tags.push({ name: 'CreatorSig', value: creatorSig });

        console.log(getFileInfo(), getLineNumber(), 'record data and tags', recordData, tags)

        const receipt = await irys.upload(recordData, { tags });
        console.log(getFileInfo(), getLineNumber(), 'Record published:', receipt.id)
        const transactionId = receipt.id;
        const didTx = txidToDid(transactionId);

        return { transactionId, didTx, dataForSignature, creatorSig };
    } catch (error) {
        console.error('Error publishing new record:', error);
    }
}

async function publishNewTemplate(template) {
    try {
        console.log(getFileInfo(), getLineNumber(), 'publishNewTemplate', template)

        const templateName = Object.keys(template)[0];
        const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));

        const myPublicKey = jwk.n;
        const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest()); // need to keep off for now till ready to update

        const irys = await getIrysArweave();
        const tags = [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Index-Method', value: 'OIP' },
            { name: 'Ver', value: '0.7.2' },
            { name: 'Type', value: 'Template' },
            { name: 'TemplateName', value: `${templateName}` },
            { name: 'Creator', value: `${myAddress}` }
        ];

        const templateNoName = Object.values(template)[0];
        const templateString = JSON.stringify(templateNoName);
        const dataForSignature = templateString + JSON.stringify(tags);
        const creatorSig = await signMessage(dataForSignature);
        tags.push({ name: 'CreatorSig', value: creatorSig });
        const receipt = await irys.upload(templateString, { tags });
        const transactionId = receipt.id;
        return { transactionId };
    } catch (error) {
        console.error('Error publishing template:', error);
    }
}

async function uploadToIPFS(videoFile) {
    try {
        console.log('Uploading video to IPFS...');
        const fileBuffer = fs.readFileSync(videoFile);

        // Dynamically import the ES module
        const { create } = await import('ipfs-http-client');

        const ipfs = create({
            host: 'localhost',
            port: '5001',
            protocol: 'http',
            fetch: (url, options) => {
                options.duplex = 'half';
                return fetch(url, options);
            }
        });

        const ipfsResult = await ipfs.add(fileBuffer);
        const ipfsHash = ipfsResult.cid.toString();

        console.log(`Video uploaded to IPFS with CID: ${ipfsHash}`);
        return ipfsHash;
    } catch (error) {
        console.error('Error uploading to IPFS:', error);
        throw error;
    }
}

async function publishVideoFiles(videoPath, videoID, uploadToArweave = false) {
    // console.log(getFileInfo(), getLineNumber(), 'publishVideoFiles', { videoPath, videoID, uploadToArweave })
    try {
      const videoFile = path.resolve(videoPath);
      let videoFiles = {};
      torrent = await createAndSeedTorrent(videoFile);
        if (torrent) {
            // console.log(`Torrent created and seeded: ${torrent.magnetURI}`);
            videoFiles = {
                torrentAddress: torrent.magnetURI
            };
            return videoFiles; 
        }
  
    //   // Step 2: Upload to IPFS
    //   console.log('Uploading video to IPFS...');
    //   const fileBuffer = fs.readFileSync(videoFile);
    //   const ipfsResult = await ipfs.add(fileBuffer);
    //   const ipfsHash = ipfsResult.cid.toString();
    //   console.log(`Video uploaded to IPFS with CID: ${ipfsHash}`);
        // ipfsAddress = await uploadToIPFS(videoFile);
        // if (ipfsAddress) {
        //     console.log(`Video uploaded to IPFS with CID: ${ipfsAddress}`);
        // }
  
      // Step 3: Optionally Upload to Arweave
    //   if (uploadToArweave) {
    //     console.log('Uploading video to Arweave...');
    //     await uploadToArweaveMethod(videoID, videoFile);
    //   }
    //   return (torrent, null, null);
    //   return { ipfsHash, videoFile };
  
    } catch (error) {
      console.error('Error publishing video:', error);
    }
}

async function publishArticleText(outputPath, articleTitle, articleAuthor, articleTags, uploadToArweave = false) {
    try {
        console.log('Publishing article text...', outputPath);
        // Step 1: Write article text to a temporary file
        // const tempFilePath = path.join(__dirname, 'tempArticle.txt');
        // fs.writeFileSync(tempFilePath, articleText);

        // Step 2: Adding to bittorrent
        const torrent = await createAndSeedTorrent(outputPath);
        console.log(`Article text added to BitTorrent. Magnet URI: ${torrent.magnetURI}`);

        // Clean up the temporary file
        // fs.unlinkSync(tempFilePath);

        return { torrent };

    } catch (error) {
        console.error('Error publishing article text:', error);
    }
}

async function publishImage(imagePath, uploadToArweave = false) {
    try {
        const imageFile = fs.readFileSync(imagePath);

        // Step 1: Create and seed torrent
        const torrent = await createAndSeedTorrent(imageFile);

        // Step 2: Upload to IPFS
        // const ipfsAddress = await uploadToIPFS(imageFile);
        // console.log(`Image uploaded to IPFS with CID: ${ipfsAddress}`);

        // Step 3: Optionally Upload to Arweave
        if (uploadToArweave) {
            console.log('Uploading image to Arweave...');
            await uploadToArweaveMethod(imagePath, imageFile);
        }

        return torrent

    } catch (error) {
        console.error('Error publishing image:', error);
    }
}

  async function uploadToArweaveMethod(videoID, videoFile) {
    // Step 1: Load video file metadata (Assuming you have a metadata fetch method)
    console.log('Retrieving video information...');
    const videoInfo = await video_basic_info(`https://www.youtube.com/watch?v=${videoID}`);
    
    // Step 2: Prepare tags and video file upload to Arweave
    const tags = [
      { name: "Content-Type", value: "video/mp4" },
      { name: "AppName", value: "VideoToArweave" },
      { name: "Video-Title", value: videoInfo.video_details.title },
      { name: "Video-Creator", value: videoInfo.video_details.channel.name },
      { name: "Video-Tags", value: JSON.stringify(videoInfo.video_details.tags) }
    ];
  
    console.log(`Uploading video to Arweave with tags: ${JSON.stringify(tags)}`);
    
    const txid = await uploadFileToArweave(videoFile, tags);  // Assuming `uploadFileToArweave` is your Arweave upload function
    console.log(`Video uploaded to Arweave. Transaction ID: ${txid}`);
    
    return txid;
  }

async function uploadFileToArweave(filePath, tags) {
    const data = fs.readFileSync(filePath);
    const tx = await arweave.createTransaction({ data });
    
    tags.forEach(tag => {
      tx.addTag(tag.name, tag.value);
    });
    
    await arweave.transactions.sign(tx);
    await arweave.transactions.post(tx);
    
    return tx.id;
  }

async function resolveRecords(record, resolveDepth, recordsInDB) {
    if (resolveDepth === 0 || !record) {
        return record;
    }

    if (!Array.isArray(record.data)) {
        console.error('record.data is not an array:', record.data);
        return record;
    }

    for (const item of record.data) {
        for (const category of Object.keys(item)) {
            const properties = item[category];

            for (const key of Object.keys(properties)) {
                if (typeof properties[key] === 'string' && properties[key].startsWith('did:')) {
                    console.log(getFileInfo(), getLineNumber(), 'Resolving DID:', properties[key]);
                    const recordInDB = await searchRecordInDB(properties[key], recordsInDB);
                    if (recordInDB) {
                        properties[key] = await resolveRecords(recordInDB, resolveDepth - 1, recordsInDB);
                    }
                } else if (Array.isArray(properties[key])) {
                    for (let i = 0; i < properties[key].length; i++) {
                        if (typeof properties[key][i] === 'string' && properties[key][i].startsWith('did:')) {
                            const recordInDB = await searchRecordInDB(properties[key][i], recordsInDB);
                            if (recordInDB) {
                                properties[key][i] = await resolveRecords(recordInDB, resolveDepth - 1, recordsInDB);
                            }
                        }
                    }
                }
            }
        }
    }
    return record;
}

module.exports = {
    resolveRecords,
    publishNewRecord,
    publishNewTemplate,
    publishVideoFiles,
    publishArticleText,
    publishImage
};