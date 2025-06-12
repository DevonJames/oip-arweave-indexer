/**
 * Example of Bisq API integration in OIP
 */
const BisqApi = require('../bisq-daemon/bisq-api-wrapper');

// Create the Bisq API client
const bisq = new BisqApi({
  // Use 'bisq' as the hostname when connecting from within Docker network
  host: process.env.NODE_ENV === 'production' ? 'bisq' : 'localhost',
  port: 9998,
  password: process.env.BISQ_API_PASSWORD || 'bisq'
});

/**
 * Get current market information from Bisq
 */
async function getBisqMarketInfo() {
  try {
    // Get all available markets
    const markets = await bisq.getMarkets();
    console.log('Available markets:', markets);
    
    // Get market depth for BTC/USD
    const depth = await bisq.getMarketDepth('BTC_USD');
    return {
      markets,
      btcUsdDepth: depth
    };
  } catch (error) {
    console.error('Error fetching Bisq market data:', error);
    return { error: 'Failed to fetch market data' };
  }
}

/**
 * Get current offers for a specific market
 */
async function getBisqOffers(direction = 'BUY', currencyCode = 'USD') {
  try {
    const offers = await bisq.getOffers(direction, currencyCode);
    return offers;
  } catch (error) {
    console.error(`Error fetching ${direction} offers for ${currencyCode}:`, error);
    return { error: 'Failed to fetch offers' };
  }
}

/**
 * Get Bitcoin wallet balance from Bisq
 */
async function getBisqWalletBalance() {
  try {
    const balance = await bisq.getWalletBalance();
    return balance;
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    return { error: 'Failed to fetch wallet balance' };
  }
}

/**
 * Example of creating an Express route to expose Bisq data
 */
function setupBisqRoutes(app) {
  // Get market data
  app.get('/api/bisq/markets', async (req, res) => {
    try {
      const marketInfo = await getBisqMarketInfo();
      res.json(marketInfo);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get market data' });
    }
  });
  
  // Get offers
  app.get('/api/bisq/offers/:direction/:currencyCode', async (req, res) => {
    try {
      const { direction, currencyCode } = req.params;
      const offers = await getBisqOffers(direction, currencyCode);
      res.json(offers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get offers' });
    }
  });
  
  // Get wallet balance
  app.get('/api/bisq/wallet/balance', async (req, res) => {
    try {
      const balance = await getBisqWalletBalance();
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get wallet balance' });
    }
  });
}

module.exports = {
  bisqClient: bisq,
  getBisqMarketInfo,
  getBisqOffers,
  getBisqWalletBalance,
  setupBisqRoutes
}; 