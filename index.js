const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const recordRoutes = require('./routes/records');
const templateRoutes = require('./routes/templates');
const creatorRoutes = require('./routes/creators');
const scrapeRoutes = require('./routes/scrape');
const healthRoutes = require('./routes/health');
const generateRoutes = require('./routes/generate');
const userRoutes = require('./routes/user');
const { keepDBUpToDate, remapExistingRecords } = require('./helpers/elasticsearch');
const minimist = require('minimist');
dotenv.config();
const cors = require('cors');
const app = express();
const { getIsProcessing, setIsProcessing } = require('./helpers/processingState');
const path = require('path');


// Set higher body size limit (e.g., 10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// CORS configuration
const corsOptions = {
    origin: '*',  // Allows requests from any origin (for development). Change this to specific origins in production
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,  
    optionsSuccessStatus: 204
};

// Use CORS middleware
app.use(cors(corsOptions));

app.options('*', cors());  // Allow preflight for all routes

const port = process.env.PORT || 3005;

app.use((req, res, next) => {
    next();
});

app.use(bodyParser.json());

app.use('/api/generate/media', express.static(path.join(__dirname, 'media')));

app.use('/api/records', recordRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/creators', creatorRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/user', userRoutes);

let isProcessing = false;  // Flag to indicate if the process is running

app.listen(port, async () => {
    console.log(`Server is running on port ${port}`);

    // Parse command-line arguments
    const args = minimist(process.argv.slice(2));

    // Initialize remapTemplates to an empty array
    let remapTemplates = [];

    // Check if --remapTemplates flag is present and parse its values
    if (args.remapTemplates) {
        remapTemplates = args.remapTemplates.split(',');
        console.log(`Remap templates enabled for: ${remapTemplates.join(', ')}`);

        // Call the function to remap existing records
        await remapExistingRecords(remapTemplates); // Pass remapTemplates to remap existing records
    }

    // Check if --keepDBUpToDate flag is present
    if (args.keepDBUpToDate) {
        let wait = 0;
        if (!isNaN(args._[0])) {
            wait = Number(args._[0]);
        }
        let interval = 60;
        if (!isNaN(args._[1])) {
            interval = Number(args._[1]);
        }
        console.log(`After a delay of ${wait} seconds, will check Arweave for new OIP data every ${interval} seconds`);

        // setTimeout(() => {
        //     keepDBUpToDate(remapTemplates);
        //     setInterval(async () => {
        //         keepDBUpToDate(remapTemplates);
        //     }, interval * 1000);
        // }, wait * 1000);
        setTimeout(() => {
            keepDBUpToDate(remapTemplates);
            setInterval(async () => {
                // Only start a new process if one isn't already running
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
            }, interval * 1000);
        }, wait * 1000)

    }
});