/**
 * OIP Arweave Server
 * Main entry point for the application
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('@elastic/elasticsearch');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const { createSwapsIndex, initializeIndices } = require('./config/createIndices');
const { validateEnvironment } = require('./config/checkEnvironment');
const dotenv = require('dotenv');
const rootRoute = require('./routes/api');
const recordRoutes = require('./routes/records');
const templateRoutes = require('./routes/templates');
const creatorRoutes = require('./routes/creators');
const scrapeRoutes = require('./routes/scrape');
const healthRoutes = require('./routes/health');
const generateRoutes = require('./routes/generate');
const userRoutes = require('./routes/user');
const walletRoutes = require('./routes/wallet');
const publishRecords = require('./routes/publish');
const workoutRoutes = require('./routes/workout');
const { getIsProcessing, setIsProcessing } = require('./helpers/processingState');
const { keepDBUpToDate, remapExistingRecords, deleteRecordsByBlock, deleteRecordsByIndexedAt, deleteRecordsByIndex } = require('./helpers/elasticsearch');
const minimist = require('minimist');
const socket = require('./socket');
const litRoutes = require('./routes/lit');
const jfkRoutes = require('./routes/jfk');
const voiceRoutes = require('./routes/voice');

dotenv.config();

// Validate environment variables
validateEnvironment();

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
      'http://localhost:3005',
      'http://localhost:8080',
      'https://api.oip.onl',
      'https://api.elevenlabs.io',
      'wss://api.elevenlabs.io',
      'https://api.fitnessally.io',
      'https://librairian.net'
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

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Define routes for static admin pages
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin_login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_login.html'));
});

app.use(bodyParser.json());

// API routes
app.use('/api', rootRoute);
app.use('/api/records', recordRoutes);
app.use('/api/publish', publishRecords);
app.use('/api/templates', templateRoutes);
app.use('/api/creators', creatorRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/generate/media', express.static(path.join(__dirname, 'media')));
app.use('/api/user', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/workout', workoutRoutes);
app.use('/api/lit', litRoutes);
app.use('/api/jfk', jfkRoutes);
app.use('/api/voice', voiceRoutes);

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

// Initialize indices first, then start the server
initializeIndices()
  .then(() => {
    // Start the server only after indices are initialized
    const serverInstance = server.listen(port, async () => {
      console.log(`Server is running on port ${port}`);

      // Parse command-line arguments
      const args = minimist(process.argv.slice(2));

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

      // Initialize remapTemplates
      let remapTemplates = [];
      if (args.remapTemplates) {
          remapTemplates = args.remapTemplates.split(',');
          console.log(`Remap templates enabled for: ${remapTemplates.join(', ')}`);
          await remapExistingRecords(remapTemplates);
      }

      // Periodically keep DB up to date
      if (args.keepDBUpToDate) {
          const wait = args._[0] ? parseInt(args._[0], 10) : 0; // Delay in seconds
          const interval = args._[1] ? parseInt(args._[1], 10) : 600; // Interval in seconds

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

          setTimeout(() => {
              // console.log("Starting first cycle...");
              keepDBUpToDate(remapTemplates);
              setIsProcessing(true);
              setInterval(async () => {
                  if (!getIsProcessing()) {
                      try {
                          // console.log("Starting new cycle...");
                          setIsProcessing(true);
                          await keepDBUpToDate(remapTemplates);
                      } catch (error) {
                          console.error("Error during keepDBUpToDate:", error);
                      } finally {
                          setIsProcessing(false);
                      }
                  } else {
                      console.log("Skipping new cycle because a previous process is still running.");
                  }
                  // console.log('Interval over, getIsProcessing:', getIsProcessing());
              }, interval * 1000);
          }, wait * 1000);
      }
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

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});