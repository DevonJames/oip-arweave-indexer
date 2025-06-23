const ongoingDialogues = new Map();

// Shared state to store ongoing scrapes
const ongoingScrapes = new Map();

// Function to safely cleanup a scrape entry
function cleanupScrape(scrapeId) {
    if (ongoingScrapes.has(scrapeId)) {
        const streamData = ongoingScrapes.get(scrapeId);
        if (streamData && streamData.clients) {
            // Close all client connections
            streamData.clients.forEach(client => {
                try {
                    if (typeof client.end === 'function') {
                        client.end();
                    }
                } catch (err) {
                    console.error('Error closing client connection:', err);
                }
            });
        }
        ongoingScrapes.delete(scrapeId);
        console.log(`Cleaned up scrape entry for ${scrapeId}`);
    }
}

// Function to get all active scrape IDs
function getActiveScrapeIds() {
    return Array.from(ongoingScrapes.keys());
}

module.exports = {
  ongoingDialogues,
  ongoingScrapes,
  cleanupScrape,
  getActiveScrapeIds
};