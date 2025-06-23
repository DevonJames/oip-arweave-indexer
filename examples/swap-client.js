/**
 * Swap API Test Client
 * Demonstrates how to interact with the BTC to XMR swap API
 */
const axios = require('axios');

// Base URL for the API
const API_BASE_URL = process.env.API_URL || 'http://localhost:3005/api';

// Simple axios wrapper for consistent error handling
async function apiRequest(method, endpoint, data = null) {
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': 'example-client' // Optional client identifier
      }
    };
    
    let response;
    if (method === 'GET') {
      response = await axios.get(url, config);
    } else if (method === 'POST') {
      response = await axios.post(url, data, config);
    } else if (method === 'DELETE') {
      response = await axios.delete(url, config);
    }
    
    return response.data;
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with an error status
      console.error(`API Error (${error.response.status}):`, error.response.data);
      throw new Error(`API Error: ${error.response.data.error || 'Unknown error'}`);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from server:', error.request);
      throw new Error('No response from server. Is the API running?');
    } else {
      // Something happened in setting up the request
      console.error('Request setup error:', error.message);
      throw error;
    }
  }
}

/**
 * Example: Get supported swap pairs
 */
async function getSupportedPairs() {
  console.log('Getting supported swap pairs...');
  const response = await apiRequest('GET', '/swap');
  console.log('Supported pairs:', response.supportedPairs);
  console.log('Swap metrics:', response.metrics);
  return response;
}

/**
 * Example: Get a quote for a BTC to XMR swap
 * @param {number} btcAmount - Amount of BTC to swap
 */
async function getBtcXmrQuote(btcAmount) {
  console.log(`Getting quote for ${btcAmount} BTC to XMR swap...`);
  const response = await apiRequest('GET', `/swap/btc-xmr/quote?amount=${btcAmount}`);
  console.log('Quote received:');
  console.log(`- You send: ${response.requestedBtcAmount} BTC`);
  console.log(`- You receive: approximately ${response.expectedXmrAmount} XMR`);
  console.log(`- Exchange rate: 1 BTC = ${1/response.exchangeRate} XMR`);
  console.log(`- Estimated completion time: ${response.estimatedCompletionTimeMinutes} minutes`);
  console.log(`- Quote valid until: ${response.quoteValidUntil}`);
  return response;
}

/**
 * Example: Initialize a BTC to XMR swap
 * @param {number} btcAmount - Amount of BTC to swap
 * @param {string} xmrAddress - Monero address to receive funds
 */
async function initializeBtcXmrSwap(btcAmount, xmrAddress) {
  console.log(`Initializing swap: ${btcAmount} BTC → XMR to ${xmrAddress}`);
  
  const swapData = {
    btcAmount,
    xmrAddress,
    customData: {
      purpose: 'Example swap',
      source: 'swap-client.js',
      timestamp: new Date()
    }
  };
  
  const response = await apiRequest('POST', '/swap/btc-xmr', swapData);
  
  console.log('Swap initialized:');
  console.log(`- Swap ID: ${response.swapId}`);
  console.log(`- Send exactly ${response.depositAmount} BTC to ${response.depositAddress}`);
  console.log(`- Expected rate: ${response.expectedRate}`);
  console.log(`- Estimated completion by: ${response.estimatedCompletionTime}`);
  console.log('- Instructions:');
  response.instructions.forEach((instruction, index) => {
    console.log(`  ${index + 1}. ${instruction}`);
  });
  
  return response;
}

/**
 * Example: Check the status of a swap
 * @param {string} swapId - ID of the swap to check
 */
async function checkSwapStatus(swapId) {
  console.log(`Checking status of swap ${swapId}...`);
  const response = await apiRequest('GET', `/swap/${swapId}`);
  
  console.log('Swap status:');
  console.log(`- Status: ${response.status} (${response.userFriendlyStatus})`);
  console.log('- Next steps:');
  response.nextSteps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step}`);
  });
  
  if (response.logs && response.logs.length > 0) {
    console.log('- Swap history:');
    response.logs.forEach(log => {
      console.log(`  ${new Date(log.time).toLocaleString()}: ${log.status} - ${log.message}`);
    });
  }
  
  return response;
}

/**
 * Example: Cancel a swap (if possible)
 * @param {string} swapId - ID of the swap to cancel
 */
async function cancelSwap(swapId) {
  console.log(`Attempting to cancel swap ${swapId}...`);
  try {
    const response = await apiRequest('DELETE', `/swap/${swapId}`);
    console.log('Swap canceled successfully:', response.message);
    return response;
  } catch (error) {
    console.error('Failed to cancel swap:', error.message);
    throw error;
  }
}

/**
 * Run the full demo
 */
async function runDemo() {
  try {
    // 1. Get supported pairs
    await getSupportedPairs();
    
    // 2. Get a quote for BTC to XMR
    const btcAmount = 0.01; // Example amount
    const quote = await getBtcXmrQuote(btcAmount);
    
    // 3. Initialize a swap (comment out to avoid creating real swaps)
    // For a real swap you would need a valid Monero address
    /*
    const xmrAddress = '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A';
    const swap = await initializeBtcXmrSwap(btcAmount, xmrAddress);
    
    // 4. Check swap status
    await checkSwapStatus(swap.swapId);
    
    // 5. Cancel swap (if possible)
    // await cancelSwap(swap.swapId);
    */
    
    console.log('Demo completed successfully!');
  } catch (error) {
    console.error('Demo failed:', error.message);
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  runDemo();
}

module.exports = {
  getSupportedPairs,
  getBtcXmrQuote,
  initializeBtcXmrSwap,
  checkSwapStatus,
  cancelSwap
}; 