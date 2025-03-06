const express = require('express');
const bodyParser = require('body-parser');
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
const { getIsProcessing, setIsProcessing } = require('./helpers/processingState');
const { keepDBUpToDate, remapExistingRecords, deleteRecordsByBlock, deleteRecordsByIndexedAt, deleteRecordsByIndex } = require('./helpers/elasticsearch');
const minimist = require('minimist');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socket = require('./socket');
const elevenLabsRoutes = require('./routes/elevenlabs');

dotenv.config();
const app = express();
const server = http.createServer(app);

// Initialize socket.io
socket.init(server);

// Set higher body size limit (e.g., 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// CORS configuration
const corsOptions = {
    origin: ['https://api.oip.onl', 'http://localhost:3005', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors()); // Allow preflight for all routes

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
app.use('/api/elevenlabs', elevenLabsRoutes);

let isProcessing = false; // Flag to indicate if the process is running

server.listen(port, async () => {
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
        const interval = args._[1] ? parseInt(args._[1], 10) : 60; // Interval in seconds

        if (isNaN(wait) || isNaN(interval)) {
            console.error('Invalid arguments for --keepDBUpToDate. Provide delay and interval as numbers.');
            process.exit(1);
        }

        console.log(`After a delay of ${wait} seconds, will check Arweave for new OIP data every ${interval} seconds`);

        setTimeout(() => {
            console.log("Starting first cycle...");
            keepDBUpToDate(remapTemplates);
            setIsProcessing(true);
            setInterval(async () => {
                if (!getIsProcessing()) {
                    try {
                        console.log("Starting new cycle...");
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
                console.log('Interval over, getIsProcessing:', getIsProcessing());
            }, interval * 1000);
        }, wait * 1000);
    }
});