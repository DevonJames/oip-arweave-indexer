/**
 * OIP Arweave Server
 * Main entry point for the application
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('@elastic/elasticsearch');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const apiLogger = require('./middleware/apiLogger');
const { createSwapsIndex, initializeIndices } = require('./config/createIndices');
const { validateEnvironment } = require('./config/checkEnvironment');
const dotenv = require('dotenv');
const rootRoute = require('./routes/api');
const recordRoutes = require('./routes/records');
const templateRoutes = require('./routes/templates');
const creatorRoutes = require('./routes/creators');
const organizationRoutes = require('./routes/organizations');
const scrapeRoutes = require('./routes/scrape');
const healthRoutes = require('./routes/health');
const generateRoutes = require('./routes/generate');
const { router: userRoutes } = require('./routes/user');
const walletRoutes = require('./routes/wallet');
const publishRecords = require('./routes/publish');
const workoutRoutes = require('./routes/workout');
const { getIsProcessing, setIsProcessing } = require('./helpers/processingState');
const { keepDBUpToDate, remapExistingRecords, deleteRecordsByBlock, deleteRecordsByDID, deleteRecordsByIndexedAt, deleteRecordsByIndex, deleteIndex } = require('./helpers/elasticsearch');
const minimist = require('minimist');
const socket = require('./socket');
const litRoutes = require('./routes/lit');
const jfkRoutes = require('./routes/jfk');
const voiceRoutes = require('./routes/voice');
const alfredRoutes = require('./routes/alfred');
const mediaRoutes = require('./routes/media');
const cleanupRoutes = require('./routes/cleanup');
const photoRoutes = require('./routes/photo');
const recipesRoutes = require('./routes/recipes');
const narrationRoutes = require('./routes/narration');
const { getMediaSeeder } = require('./services/mediaSeeder');
const axios = require('axios');

dotenv.config();

// MEMORY LEAK FIX: Add axios response interceptor to clean up arraybuffers
// This prevents 47GB+ external memory leaks from TTS audio and image downloads
axios.interceptors.response.use(
  (response) => {
    // If response contains arraybuffer data, implement immediate cleanup
    if (response.config.responseType === 'arraybuffer' && response.data) {
      const originalData = response.data;
      const bufferSize = originalData.byteLength || originalData.length || 0;
      
      // Log large buffers being created
      if (bufferSize > 1024 * 1024) { // > 1MB
        console.log(`📦 [Axios] Created ${Math.round(bufferSize / 1024 / 1024)}MB arraybuffer`);
      }
      
      // Create a proxy to track when the data is accessed
      let dataAccessed = false;
      const dataProxy = new Proxy(originalData, {
        get(target, prop) {
          dataAccessed = true;
          return target[prop];
        }
      });
      
      // Override the response data with our proxy
      Object.defineProperty(response, 'data', {
        get() {
          return dataProxy;
        },
        set(value) {
          // Allow setting to null for cleanup
          if (value === null) {
            response._data = null;
            return;
          }
          response._data = value;
        }
      });
      
      // Immediate cleanup after data is accessed
      const cleanup = () => {
        if (dataAccessed && response._data) {
          response._data = null;
          if (global.gc && bufferSize > 1024 * 1024) {
            setImmediate(() => {
              global.gc();
              console.log(`🧹 [Axios] Released ${Math.round(bufferSize / 1024 / 1024)}MB arraybuffer`);
            });
          }
        }
      };
      
      // Clean up after a short delay to allow the data to be processed
      setTimeout(cleanup, 1000); // 1 second instead of 30 seconds
      
      // Also clean up on next tick if data was accessed
      setImmediate(() => {
        if (dataAccessed) {
          cleanup();
        }
      });
    }
    return response;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Validate environment variables
validateEnvironment();

// Initialize GUN Sync Service (will be started after server is ready)
let gunSyncService = null;
if (process.env.GUN_SYNC_ENABLED !== 'false') {
    const { GunSyncService } = require('./helpers/gunSyncService');
    gunSyncService = new GunSyncService();
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Initialize socket.io
socket.init(server);

// Set higher body size limit (e.g., 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Clean API logging
app.use(apiLogger);

// CORS middleware configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow Chrome extension origins
    if (origin.startsWith('chrome-extension://')) {
      console.log(`[CORS] Allowing Chrome extension: ${origin}`);
      return callback(null, true);
    }
    
    // Allow Firefox extension origins
    if (origin.startsWith('moz-extension://')) {
      console.log(`[CORS] Allowing Firefox extension: ${origin}`);
      return callback(null, true);
    }
    
    // Allow Safari extension origins
    if (origin.startsWith('safari-web-extension://')) {
      console.log(`[CORS] Allowing Safari extension: ${origin}`);
      return callback(null, true);
    }
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',  // Added for ALFRED voice interface
      'http://localhost:3005',  // Keep hardcoded as requested
      `http://localhost:${process.env.PORT || 3005}`,  // Also allow env PORT
      'http://localhost:5173',
      'http://localhost:8080',
      'https://api.oip.onl',
      'https://api.elevenlabs.io',
      'wss://api.elevenlabs.io',
      'https://api.fitnessally.io',
      'https://librairian.net',
      'https://oip.fitnessally.io',
      'https://app.fitnessally.io',
      'https://mini.fitnessally.io',
      'https://mobile.fitnessally.io'
    ];
    
    // Allow any localhost origin in development
    if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'xi-api-key'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Additional headers for ElevenLabs compatibility
app.use((req, res, next) => {
  // Allow WebSocket upgrades
  if (req.headers.upgrade === 'websocket') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  next();
});

const port = process.env.PORT || 3005;

app.use((req, res, next) => {
    next();
});

// Public runtime config for static clients (e.g., reference-client.html)
// Exposes window.API_BASE_URL derived from env var PUBLIC_API_BASE_URL and PORT
app.get('/config.js', (req, res) => {
  const apiBase = process.env.PUBLIC_API_BASE_URL || '';
  const port = process.env.PORT || 3005;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  const safeApiBase = String(apiBase).replace(/'/g, "\\'");
  res.send(`window.API_BASE_URL = '${safeApiBase}'; window.OIP_PORT = ${port};`);
});

// Serve static files from the 'public' directory (or custom path if specified)
// In Docker, the entrypoint script handles symlinking, so we always use ./public
// In non-Docker, we check for parent directory when CUSTOM_PUBLIC_PATH=true
const isDocker = fs.existsSync('/.dockerenv');
let publicPath;

if (process.env.CUSTOM_PUBLIC_PATH === 'true' && !isDocker) {
  // Non-Docker: Use parent directory
  publicPath = path.join(__dirname, '..', 'public');
} else {
  // Docker or default: Use local public (symlinked by entrypoint if needed)
  publicPath = path.join(__dirname, 'public');
}

console.log(`📁 Serving static files from: ${publicPath}`);
console.log(`🐳 Docker environment: ${isDocker}`);
console.log(`🔧 CUSTOM_PUBLIC_PATH: ${process.env.CUSTOM_PUBLIC_PATH}`);
app.use(express.static(publicPath));

// Define routes for static admin pages
app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
});
app.get('/admin_login', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin_login.html'));
});

app.use(bodyParser.json());

// API routes
app.use('/api', rootRoute);
app.use('/api/records', recordRoutes);
app.use('/api/publish', publishRecords);
app.use('/api/templates', templateRoutes);
app.use('/api/creators', creatorRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/generate/media', express.static(path.join(__dirname, 'media')));
// Serve web-accessible media files
app.use('/media', express.static(path.join(__dirname, 'data', 'media', 'web')));
app.use('/api/user', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/workout', workoutRoutes);
app.use('/api/lit', litRoutes);
app.use('/api/jfk', jfkRoutes);
// Mount new canonical route
app.use('/api/alfred', alfredRoutes);
// Backward-compatible alias
app.use('/api/voice', voiceRoutes);
// Photo upload and analysis routes
app.use('/api/photo', photoRoutes);
// Media storage and distribution routes
app.use('/api/media', mediaRoutes);
// Recipe image generation routes
app.use('/api/recipes', recipesRoutes);
// Template cleanup routes
app.use('/api/cleanup', cleanupRoutes);
// Document narration routes
app.use('/api', narrationRoutes);

// Make io available to routes
app.set('io', io);

// Setup Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

let isProcessing = false; // Flag to indicate if the process is running

// Initialize indices first, then check for CLI operations or start server
initializeIndices()
  .then(async () => {
    // Parse command-line arguments first
    const args = minimist(process.argv.slice(2));
    
    console.log('\n🔍 [DEBUG] Command line arguments:');
    console.log('   process.argv:', process.argv);
    console.log('   Parsed args:', JSON.stringify(args, null, 2));
    console.log('   args.keepDBUpToDate:', args.keepDBUpToDate);
    console.log('');
    
    // CLI functionality for deleting records by block
    if (args.deleteRecords && args.index && args.blockThreshold) {
        const index = args.index;
        const blockThreshold = parseInt(args.blockThreshold, 10);

        if (isNaN(blockThreshold)) {
            console.error('Invalid blockThreshold value. Please provide a valid number.');
            process.exit(1);
        }

        try {
            console.log(`Deleting records from index '${index}' with inArweaveBlock >= ${blockThreshold}...`);
            const response = await deleteRecordsByBlock(index, blockThreshold);
            console.log('Deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting records by DID
    if (args.deleteRecords && args.index && args.did) {
        const index = args.index;
        const did = args.did;

        if (!did || typeof did !== 'string') {
            console.error('Invalid DID value. Please provide a valid DID string.');
            process.exit(1);
        }

        try {
            console.log(`Deleting records from index '${index}' with DID '${did}'...`);
            const response = await deleteRecordsByDID(index, did);
            console.log('Deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting records by indexedAt timestamp
    if (args.deleteRecords && args.index && args.indexedAt) {
        const index = args.index;
        const indexedAt = args.indexedAt;

        if (isNaN(Date.parse(indexedAt))) {
            console.error('Invalid indexedAt value. Please provide a valid timestamp.');
            process.exit(1);
        }

        try {
            console.log(`Deleting records from index '${index}' with indexedAt >= ${indexedAt}...`);
            const response = await deleteRecordsByIndexedAt(index, indexedAt);
            console.log('Deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting all records from a specified index
    if (args.deleteAllRecords && args.index) {
        const index = args.index;
        console.log(`Deleting all records from index '${index}'...`);

        try {
            console.log(`Deleting all records from index '${index}'...`);
            const response = await deleteRecordsByIndex(index); 
            console.log('Deletion of all records completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion of all records:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting an entire index
    if (args.deleteIndex && args.index) {
        const indexName = args.index;
        
        if (!indexName || typeof indexName !== 'string') {
            console.error('Invalid index name. Please provide a valid index name with --deleteIndex.');
            process.exit(1);
        }

        try {
            console.log(`Deleting entire index '${indexName}'...`);
            const response = await deleteIndex(indexName);
            console.log('Index deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during index deletion:', error);
            process.exit(1);
        }
    }
    
    // If we reach here, it's not a CLI operation, so start the server
    const serverInstance = server.listen(port, async () => {
      console.log(`Server is running on port ${port}`);

      // Initialize MediaSeeder for server mode (non-blocking)
      // Don't await - let it initialize in the background so it doesn't block keepDBUpToDate
      const mediaSeeder = getMediaSeeder();
      mediaSeeder.initialize()
        .then(() => {
          console.log('🌱 MediaSeeder initialized successfully');
        })
        .catch((error) => {
          console.error('❌ Failed to initialize MediaSeeder:', error);
        });

      // Start GUN sync service after server is ready (non-blocking)
      if (gunSyncService) {
        gunSyncService.start()
          .then(() => {
            global.gunSyncService = gunSyncService; // Make globally accessible for health endpoint
            console.log('🔄 GUN Record Sync Service started successfully');
          })
          .catch((error) => {
            console.error('❌ Failed to start GUN Sync Service:', error);
          });
      }

      console.log('🔍 [DEBUG] About to start memory monitor...');
      
      // MEMORY LEAK FIX: Start memory monitor for long-running processes
      const memoryMonitorInterval = parseInt(process.env.MEMORY_MONITOR_INTERVAL) || 300000; // 5 minutes default
      const memoryWarningThreshold = parseInt(process.env.MEMORY_WARNING_THRESHOLD) || 80; // 80% threshold
      
      console.log('🔍 [DEBUG] Setting up memory monitor setInterval...');
      setInterval(() => {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(memUsage.rss / 1024 / 1024);
        const externalMB = Math.round(memUsage.external / 1024 / 1024);
        const heapUtilization = ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2);
        
        console.log(`[Memory Monitor] Heap: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapUtilization}%), RSS: ${rssMB}MB, External: ${externalMB}MB`);
        
        // Warning if external memory is excessive (> 10GB suggests buffer leak)
        if (externalMB > 10240) {
          console.warn(`⚠️  [Memory Monitor] HIGH EXTERNAL MEMORY: ${externalMB}MB (possible buffer leak from images/media)`);
          
          // Force aggressive cleanup when external memory is too high
          if (global.gc) {
            console.log('[Memory Monitor] Forcing aggressive garbage collection for external memory...');
            global.gc();
            
            // Check memory after GC
            const afterGC = process.memoryUsage();
            const afterExternalMB = Math.round(afterGC.external / 1024 / 1024);
            const freedExternalMB = externalMB - afterExternalMB;
            console.log(`[Memory Monitor] After aggressive GC: ${afterExternalMB}MB external (freed ${freedExternalMB}MB)`);
          }
        }
        
        // Warning if heap utilization is high
        if (parseFloat(heapUtilization) > memoryWarningThreshold) {
          console.warn(`⚠️  [Memory Monitor] HIGH MEMORY USAGE: ${heapUtilization}% heap utilization`);
          
          // Force garbage collection if available and heap is critically high
          if (global.gc && parseFloat(heapUtilization) > 90) {
            console.log('[Memory Monitor] Forcing garbage collection...');
            global.gc();
            
            // Log memory after GC
            const afterGC = process.memoryUsage();
            const afterHeapUsedMB = Math.round(afterGC.heapUsed / 1024 / 1024);
            const afterHeapTotalMB = Math.round(afterGC.heapTotal / 1024 / 1024);
            const afterExternalMB = Math.round(afterGC.external / 1024 / 1024);
            const freedMB = heapUsedMB - afterHeapUsedMB;
            const freedExternalMB = externalMB - afterExternalMB;
            console.log(`[Memory Monitor] After GC: ${afterHeapUsedMB}MB / ${afterHeapTotalMB}MB (freed ${freedMB}MB heap, ${freedExternalMB}MB external)`);
          }
        }
      }, memoryMonitorInterval);
      
      console.log(`✅ Memory monitor started (interval: ${memoryMonitorInterval/1000}s, warning threshold: ${memoryWarningThreshold}%)`);

      console.log('🔍 [DEBUG] Checking for remapTemplates...');
      // Initialize remapTemplates
      let remapTemplates = [];
      if (args.remapTemplates) {
          remapTemplates = args.remapTemplates.split(',');
          console.log(`Remap templates enabled for: ${remapTemplates.join(', ')}`);
          await remapExistingRecords(remapTemplates);
      } else {
          console.log('🔍 [DEBUG] No remapTemplates specified');
      }

      console.log('🔍 [DEBUG] Checking args.keepDBUpToDate:', args.keepDBUpToDate, 'Type:', typeof args.keepDBUpToDate);
      // Periodically keep DB up to date
      if (args.keepDBUpToDate) {
          console.log('🔍 [DEBUG] ✅ INSIDE keepDBUpToDate block! Setting up parameters...');
          const wait = args._[0] ? parseInt(args._[0], 10) : 0; // Delay in seconds
          // const interval = args._[1] ? parseInt(args._[1], 10) : 600; // Interval in seconds
          const interval = 300;

          if (isNaN(wait) || isNaN(interval)) {
              console.error('Invalid arguments for --keepDBUpToDate. Provide delay and interval as numbers.');
              process.exit(1);
          }
          if (interval > 120) {
            minutes = Math.floor(interval / 60);
            if (wait > 0) {
              console.log(`After a delay of ${wait} seconds, will check Arweave for new OIP data every ${minutes} minutes`);
            } else {
              console.log(`Will check Arweave for new OIP data every ${minutes} minutes`);
            }
          } else {
            if (wait > 0) {
              console.log(`After a delay of ${wait} seconds, will check Arweave for new OIP data every ${interval} seconds`);
            } else {
              console.log(`Will check Arweave for new OIP data every ${interval} seconds`);
            }
          }

          setTimeout(async () => {
              console.log("🚀 [STARTUP] Starting first keepDBUpToDate cycle...");
              try {
                  setIsProcessing(true);
                  await keepDBUpToDate(remapTemplates);
                  console.log("✅ [STARTUP] First keepDBUpToDate cycle completed successfully");
              } catch (error) {
                  console.error("❌ [STARTUP] Error during first keepDBUpToDate:", error);
              } finally {
                  setIsProcessing(false);
              }
              
              console.log(`⏰ [STARTUP] Setting up keepDBUpToDate interval (every ${interval} seconds)...`);
              setInterval(async () => {
                  const processing = getIsProcessing();
                  console.log(`\n⏱️  [INTERVAL] keepDBUpToDate interval triggered (isProcessing: ${processing})`);
                  
                  if (!processing) {
                      try {
                          console.log("▶️  [INTERVAL] Starting new keepDBUpToDate cycle...");
                          setIsProcessing(true);
                          await keepDBUpToDate(remapTemplates);
                          console.log("✅ [INTERVAL] keepDBUpToDate cycle completed");
                      } catch (error) {
                          console.error("❌ [INTERVAL] Error during keepDBUpToDate:", error);
                          console.error("❌ [INTERVAL] Stack trace:", error.stack);
                      } finally {
                          setIsProcessing(false);
                      }
                  } else {
                      console.log("⏭️  [INTERVAL] Skipping cycle - previous process still running");
                  }
              }, interval * 1000);
          }, wait * 1000);
      } else {
          console.log('⏭️  [DEBUG] keepDBUpToDate block SKIPPED - args.keepDBUpToDate is:', args.keepDBUpToDate);
      }
      
      console.log('🔍 [DEBUG] Finished server.listen callback');
    });
  })
  .catch(error => {
    console.error('Failed to initialize indices:', error);
    // Allow server to start anyway by manually calling listen
    console.log('Starting server despite index initialization failure...');
    server.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  });

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  if (gunSyncService) {
    gunSyncService.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  if (gunSyncService) {
    gunSyncService.stop();
  }
  process.exit(0);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});
