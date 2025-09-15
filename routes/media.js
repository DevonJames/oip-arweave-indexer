const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticateToken, optionalAuthenticateToken, userOwnsRecord } = require('../helpers/utils');
const { getMediaSeeder } = require('../services/mediaSeeder');
const { publishToGun } = require('../helpers/templateHelper');
const { indexRecord } = require('../helpers/elasticsearch');

const router = express.Router();

// Media directory configuration
const MEDIA_DIR = process.env.MEDIA_DIR || '/usr/src/app/data/media';

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  console.log('📁 Created media directory:', MEDIA_DIR);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(MEDIA_DIR, 'temp'));
  },
  filename: (req, file, cb) => {
    // Generate temporary filename
    const tempName = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    cb(null, tempName);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// Ensure temp directory exists
const tempDir = path.join(MEDIA_DIR, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * POST /api/media/upload
 * Upload media file and create torrent
 */
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  let tempFilePath = null;
  
  try {
    console.log('📤 Media upload request:', {
      user: req.user.email,
      file: req.file ? req.file.originalname : 'none',
      body: Object.keys(req.body)
    });

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    tempFilePath = req.file.path;
    const originalName = req.file.originalname;
    const fileSize = req.file.size;

    // Compute file hash (mediaId)
    const fileBuffer = fs.readFileSync(tempFilePath);
    const mediaId = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    console.log('🔢 Generated mediaId:', mediaId);

    // Create final directory structure
    const mediaIdDir = path.join(MEDIA_DIR, mediaId);
    if (!fs.existsSync(mediaIdDir)) {
      fs.mkdirSync(mediaIdDir, { recursive: true });
    }

    // Move file to final location
    const finalFilePath = path.join(mediaIdDir, 'original');
    fs.renameSync(tempFilePath, finalFilePath);
    tempFilePath = null; // Prevent cleanup

    console.log('📁 Moved file to:', finalFilePath);

    // Get file metadata
    const stats = fs.statSync(finalFilePath);
    const mimeType = req.file.mimetype || 'application/octet-stream';

    // Start seeding with MediaSeeder
    const mediaSeeder = getMediaSeeder();
    const seedInfo = await mediaSeeder.seedFile(finalFilePath, mediaId);

    console.log('🌱 Seeding started:', seedInfo.magnetURI);

    // Prepare access control
    const accessLevel = req.body.access_level || 'private';
    const userPublicKey = req.user.publicKey || req.user.publisherPubKey;

    if (!userPublicKey) {
      throw new Error('User public key not available');
    }

    // Create media manifest
    const mediaManifest = {
      basic: {
        name: req.body.name || originalName,
        description: `Media file: ${originalName}`,
        date: Math.floor(Date.now() / 1000),
        language: 'en'
      },
      media: {
        id: mediaId,
        did: `did:gun:media:${mediaId}`,
        mime: mimeType,
        size: fileSize,
        originalName: originalName,
        createdAt: new Date().toISOString(),
        transport: {
          bittorrent: {
            magnetURI: seedInfo.magnetURI,
            infoHash: seedInfo.infoHash,
            trackers: process.env.WEBTORRENT_TRACKERS ? 
              process.env.WEBTORRENT_TRACKERS.split(',') : 
              ['wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz']
          },
          http: [`${req.protocol}://${req.get('host')}/api/media/${mediaId}`]
        },
        version: 1
      },
      accessControl: {
        access_level: accessLevel,
        owner_public_key: userPublicKey,
        created_by: userPublicKey,
        created_timestamp: Date.now(),
        last_modified_timestamp: Date.now(),
        version: '1.0.0'
      }
    };

    // Save manifest to disk
    const manifestPath = path.join(mediaIdDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(mediaManifest, null, 2));

    console.log('💾 Saved manifest:', manifestPath);

    // Publish manifest to GUN if private, or handle public differently
    let gunResult = null;
    if (accessLevel === 'private') {
      try {
        gunResult = await publishToGun(mediaManifest, 'media', {
          storage: 'gun',
          localId: `media_${mediaId}`,
          accessControl: mediaManifest.accessControl
        });
        console.log('📡 Published manifest to GUN:', gunResult.did);
      } catch (error) {
        console.warn('⚠️ Failed to publish to GUN:', error.message);
      }
    }

    // Index to Elasticsearch
    try {
      const indexDocument = {
        data: mediaManifest,
        oip: {
          did: gunResult ? gunResult.did : `did:gun:media:${mediaId}`,
          recordType: 'media',
          storage: 'gun',
          indexedAt: new Date().toISOString(),
          ver: '0.8.0',
          creator: {
            didAddress: req.user.didAddress,
            publicKey: userPublicKey
          }
        }
      };

      await indexRecord(indexDocument);
      console.log('🔍 Indexed to Elasticsearch');
    } catch (error) {
      console.warn('⚠️ Failed to index to Elasticsearch:', error.message);
    }

    // Return response
    res.json({
      success: true,
      mediaId,
      did: gunResult ? gunResult.did : `did:gun:media:${mediaId}`,
      magnetURI: seedInfo.magnetURI,
      infoHash: seedInfo.infoHash,
      transport: mediaManifest.media.transport,
      encrypted: false,
      access_level: accessLevel,
      owner: userPublicKey,
      size: fileSize,
      mime: mimeType,
      originalName
    });

  } catch (error) {
    console.error('❌ Media upload failed:', error);

    // Cleanup temp file if it still exists
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup temp file:', cleanupError.message);
      }
    }

    res.status(500).json({ 
      error: 'Media upload failed',
      details: error.message 
    });
  }
});

/**
 * GET /api/media/:mediaId
 * Serve media file with authentication and range support
 */
router.get('/:mediaId', optionalAuthenticateToken, async (req, res) => {
  try {
    const { mediaId } = req.params;
    const mediaIdDir = path.join(MEDIA_DIR, mediaId);
    const filePath = path.join(mediaIdDir, 'original');
    const manifestPath = path.join(mediaIdDir, 'manifest.json');

    console.log('📥 Media request:', {
      mediaId,
      authenticated: req.isAuthenticated,
      user: req.user?.email
    });

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Load manifest for access control
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        console.warn('⚠️ Failed to load manifest:', error.message);
      }
    }

    // Check access control
    if (manifest && manifest.accessControl) {
      const accessLevel = manifest.accessControl.access_level;
      
      if (accessLevel === 'private') {
        if (!req.isAuthenticated) {
          return res.status(401).json({ error: 'Authentication required for private media' });
        }

        // Check ownership
        const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
        const ownerPublicKey = manifest.accessControl.owner_public_key;

        if (userPublicKey !== ownerPublicKey) {
          return res.status(403).json({ error: 'Access denied: not the owner' });
        }
      }
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const mimeType = manifest?.media?.mime || 'application/octet-stream';

    // Handle range requests for video streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      // Serve entire file
      res.set({
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes'
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }

    console.log('✅ Served media file:', mediaId);

  } catch (error) {
    console.error('❌ Failed to serve media:', error);
    res.status(500).json({ 
      error: 'Failed to serve media',
      details: error.message 
    });
  }
});

/**
 * GET /api/media/:mediaId/info
 * Get media information and manifest
 */
router.get('/:mediaId/info', optionalAuthenticateToken, async (req, res) => {
  try {
    const { mediaId } = req.params;
    const mediaIdDir = path.join(MEDIA_DIR, mediaId);
    const manifestPath = path.join(mediaIdDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Check access control
    if (manifest.accessControl && manifest.accessControl.access_level === 'private') {
      if (!req.isAuthenticated) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
      const ownerPublicKey = manifest.accessControl.owner_public_key;

      if (userPublicKey !== ownerPublicKey) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get seeding info
    const mediaSeeder = getMediaSeeder();
    const seedInfo = mediaSeeder.getSeedingInfo(mediaId);

    res.json({
      ...manifest,
      seeding: !!seedInfo,
      seedingInfo: seedInfo
    });

  } catch (error) {
    console.error('❌ Failed to get media info:', error);
    res.status(500).json({ 
      error: 'Failed to get media info',
      details: error.message 
    });
  }
});

module.exports = router;
