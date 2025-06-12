/**
 * Bisq API Connection Test
 * 
 * This script tests the connection to the Bisq daemon and falls back to mock mode if needed.
 * Run this script to diagnose connection issues with the Bisq daemon.
 */
const BisqApi = require('./bisq-api-wrapper');

async function testBisqConnection() {
  console.log('=== Bisq API Connection Test ===');
  console.log('This script will attempt to connect to the Bisq daemon and test various endpoints.');
  console.log('If connection fails, it will fall back to mock mode automatically.\n');
  
  // Set environment variable for testing
  process.env.RUNNING_IN_DOCKER = process.env.RUNNING_IN_DOCKER || false;
  
  // Create API client for localhost
  console.log('Testing connection to localhost:9998...');
  const localApi = new BisqApi({
    host: 'localhost',
    port: 9998,
    password: 'bisq'
  });
  
  // Register for mock mode changes
  localApi.onMockModeChange((enabled) => {
    console.log(`\n⚠️ MOCK MODE ENABLED: ${enabled}`);
    console.log('The API client has switched to mock mode due to connection errors.');
    console.log('This means responses are simulated and not coming from a real Bisq daemon.\n');
  });
  
  // Wait a moment for connection attempt
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    // Try to get markets
    console.log('\nTesting market data endpoint...');
    const markets = await localApi.getMarkets();
    console.log(`Found ${markets.length} markets.`);
    
    // Try to get offer data
    console.log('\nTesting offers endpoint...');
    const offers = await localApi.getOffers('SELL', 'XMR');
    console.log(`Found ${offers.length} offers for BTC/XMR.`);
    
    // Try to get wallet balance
    console.log('\nTesting wallet endpoint...');
    const balance = await localApi.getWalletBalance();
    console.log(`Wallet balance: ${balance.availableBalance} BTC`);
    
    // Show summary
    console.log('\n=== Connection Test Summary ===');
    console.log(`Mock mode: ${localApi.mockMode ? 'ENABLED' : 'DISABLED'}`);
    if (localApi.mockMode) {
      console.log('Status: Using simulated data (no actual Bisq connection)');
      console.log('Recommendation: Check if Bisq daemon is running and properly configured');
    } else {
      console.log('Status: Successfully connected to Bisq daemon');
      console.log('All endpoints working correctly');
    }
  } catch (error) {
    console.error(`\n❌ Error during testing: ${error.message}`);
    console.log('\n=== Connection Test Summary ===');
    console.log(`Mock mode: ${localApi.mockMode ? 'ENABLED' : 'DISABLED'}`);
    console.log('Status: Failed to connect to Bisq daemon');
    console.log('Recommendation: Check if Bisq daemon is running and accessible');
  }
  
  // Try with Docker container name
  if (localApi.mockMode) {
    console.log('\nTrying connection to bisq:9998 (Docker container name)...');
    const dockerApi = new BisqApi({
      host: 'bisq',
      port: 9998, 
      password: 'bisq'
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const markets = await dockerApi.getMarkets();
      if (!dockerApi.mockMode) {
        console.log(`Success! Found ${markets.length} markets.`);
        console.log('\nRecommendation: Update your code to connect to "bisq" host instead of "localhost".');
      } else {
        console.log('Still in mock mode. Neither localhost nor bisq container name works.');
      }
    } catch (error) {
      console.log('Failed to connect using bisq container name as well.');
    }
  }
}

// Run the test
testBisqConnection().catch(err => {
  console.error('Unhandled error:', err);
});

console.log('\nTIP: You can still use the application in mock mode.');
console.log('Mock mode provides simulated responses for testing and development.');
console.log('To exit this script, press Ctrl+C'); 