/**
 * Swap Route Handler
 * Provides API endpoints for cryptocurrency swaps using Bisq
 */
const express = require('express');
const router = express.Router();
// const BisqSwapWrapper = require('../../bisq-daemon/bisq-swap-wrapper');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, isAdmin, optionalAuth } = require('../middleware/auth');
const swapDataService = require('../services/swapDataService');

// Initialize bisqSwap as null
let bisqSwap = null;

// Commenting out Bisq initialization for now
/*
try {
  // Let the wrapper auto-detect the best host
  bisqSwap = new BisqSwapWrapper({
    port: 9998,
    password: process.env.BISQ_API_PASSWORD || 'bisq'
  });
  
  // Event handler for mock mode change - use the wrapper's event emission
  // which is triggered by the callback-based approach in the wrapper
  bisqSwap.on('mock-mode', (enabled) => {
    console.log(`⚠️ NOTICE: Bisq API Mock Mode ${enabled ? 'activated' : 'deactivated'}. ${enabled ? 'All swap functions will be simulated.' : ''}`);
  });
} catch (error) {
  console.error(`Failed to initialize Bisq swap wrapper: ${error.message}`);
  console.log('Some swap functionality may be limited or unavailable.');
}
*/

// Commenting out event listeners since bisqSwap is null
/*
bisqSwap.on('swap:initialized', ({ swapId, swap }) => {
  console.log(`Swap ${swapId} initialized: ${swap.details.fromCurrency} -> ${swap.details.toCurrency}`);
  
  // You could add custom logic here
  // For example, sending notifications, logging to a database, etc.
});

bisqSwap.on('swap:completed', ({ swapId, swap }) => {
  console.log(`Swap ${swapId} completed successfully`);
  
  // You could add custom logic here
  // For example, sending a success notification, updating user balance, etc.
});

bisqSwap.on('swap:failed', ({ swapId, reason, swap }) => {
  console.log(`Swap ${swapId} failed: ${reason}`);
  
  // You could add custom logic here
  // For example, sending a failure notification, refunding user, etc.
});
*/

/**
 * @route   GET /swap
 * @desc    Get swap information and supported pairs
 * @access  Public
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    // Get metrics from the service
    const metrics = await bisqSwap.getMetrics();
    
    // Return supported pairs and metrics
    res.json({
      supportedPairs: [
        {
          fromCurrency: 'BTC',
          toCurrency: 'XMR',
          minAmount: 0.001,
          maxAmount: 1.0
        }
      ],
      metrics,
      mockMode: bisqSwap.bisqApi.mockMode || false
    });
  } catch (error) {
    console.error('Error fetching swap information:', error);
    res.status(500).json({ 
      error: 'Failed to get swap information',
      message: error.message,
      mockMode: bisqSwap?.bisqApi?.mockMode || false
    });
  }
});

/**
 * @route   GET /swap/btc-xmr/quote
 * @desc    Get a quote for BTC to XMR swap
 * @access  Public
 */
router.get('/btc-xmr/quote', optionalAuth, async (req, res) => {
  try {
    const amount = parseFloat(req.query.amount);
    
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount specified' });
    }
    
    // Get offers for XMR
    const offers = await bisqSwap.bisqApi.getOffers('SELL', 'XMR');
    
    // Find best offer
    const bestOffer = offers.find(offer => {
      return offer.minAmount <= amount && offer.maxAmount >= amount;
    });
    
    if (!bestOffer) {
      return res.status(404).json({ 
        error: 'No offers available for the requested amount',
        mockMode: bisqSwap.bisqApi.mockMode || false
      });
    }
    
    // Calculate expected XMR amount
    const expectedXmrAmount = (amount / bestOffer.price).toFixed(8);
    
    res.json({
      fromCurrency: 'BTC',
      toCurrency: 'XMR',
      requestedBtcAmount: amount,
      expectedXmrAmount,
      exchangeRate: bestOffer.price,
      offerCount: offers.length,
      estimatedFees: '0.0001',
      estimatedCompletionTimeMinutes: 70,
      quoteValidUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      mockMode: bisqSwap.bisqApi.mockMode || false
    });
  } catch (error) {
    console.error('Error getting quote:', error);
    res.status(500).json({ 
      error: 'Failed to get quote',
      message: error.message,
      mockMode: bisqSwap?.bisqApi?.mockMode || false
    });
  }
});

/**
 * @route   POST /swap/btc-xmr
 * @desc    Initialize a BTC to XMR swap
 * @access  Private (requires authentication)
 */
router.post('/btc-xmr', authenticateToken, async (req, res) => {
  try {
    const { btcAmount, xmrAddress, customData } = req.body;
    
    if (!btcAmount || isNaN(parseFloat(btcAmount)) || parseFloat(btcAmount) <= 0) {
      return res.status(400).json({ error: 'Invalid BTC amount specified' });
    }
    
    if (!xmrAddress) {
      return res.status(400).json({ error: 'XMR receiving address is required' });
    }
    
    // Initialize the swap
    const swapResult = await bisqSwap.initializeSwap({
      fromCurrency: 'BTC',
      toCurrency: 'XMR',
      amount: parseFloat(btcAmount),
      toAddress: xmrAddress,
      direction: 'SELL',
      customData: {
        ...customData,
        userId: req.user?.id
      }
    });
    
    res.json({
      ...swapResult,
      mockMode: bisqSwap.bisqApi.mockMode || false
    });
  } catch (error) {
    console.error('Error initializing swap:', error);
    res.status(500).json({ 
      error: 'Failed to initialize swap',
      message: error.message,
      mockMode: bisqSwap?.bisqApi?.mockMode || false
    });
  }
});

/**
 * @route   GET /swap/:swapId
 * @desc    Get the status of a specific swap
 * @access  Mixed (public for general info, private for user-specific swaps)
 */
router.get('/:swapId', optionalAuth, async (req, res) => {
  try {
    const { swapId } = req.params;
    
    if (!swapId) {
      return res.status(400).json({ error: 'Swap ID is required' });
    }
    
    // Get swap status
    const swap = await bisqSwap.getSwapStatus(swapId);
    
    // Convert to user-friendly format
    const userFriendlyStatus = getUserFriendlyStatus(swap.status);
    const nextSteps = getNextStepsForStatus(swap.status, swap);
    
    res.json({
      ...swap,
      userFriendlyStatus,
      nextSteps,
      mockMode: bisqSwap.bisqApi.mockMode || false
    });
  } catch (error) {
    console.error(`Error getting swap status for ${req.params.swapId}:`, error);
    res.status(500).json({ 
      error: 'Failed to get swap status',
      message: error.message,
      mockMode: bisqSwap?.bisqApi?.mockMode || false
    });
  }
});

/**
 * @route   DELETE /swap/:swapId
 * @desc    Cancel a swap if possible
 * @access  Private (requires authentication)
 */
router.delete('/:swapId', authenticateToken, async (req, res) => {
  try {
    const { swapId } = req.params;
    
    if (!swapId) {
      return res.status(400).json({ error: 'Swap ID is required' });
    }
    
    // Cancel the swap
    const result = await bisqSwap.cancelSwap(swapId);
    
    res.json({
      ...result,
      mockMode: bisqSwap.bisqApi.mockMode || false
    });
  } catch (error) {
    console.error(`Error canceling swap ${req.params.swapId}:`, error);
    res.status(500).json({ 
      error: 'Failed to cancel swap',
      message: error.message,
      mockMode: bisqSwap?.bisqApi?.mockMode || false
    });
  }
});

/**
 * @route   GET /swap/user/history
 * @desc    Get swap history for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/user/history', authenticateToken, async (req, res) => {
  try {
    const userSwaps = await swapDataService.getUserSwaps(req.user.id);
    
    // Enhance with user-friendly information
    const enhancedSwaps = userSwaps.map(swap => ({
      ...swap,
      userFriendlyStatus: getUserFriendlyStatus(swap.status)
    }));
    
    res.json(enhancedSwaps);
  } catch (error) {
    console.error('Error fetching user swap history:', error);
    res.status(500).json({ error: 'Failed to fetch swap history' });
  }
});

/**
 * @route   GET /swap/admin/all
 * @desc    Get all swaps (admin only)
 * @access  Private (admin only)
 */
router.get('/admin/all', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { status, userId, limit = 100 } = req.query;
    
    let swaps;
    if (status) {
      swaps = await swapDataService.getSwapsByStatus(status);
    } else if (userId) {
      swaps = await swapDataService.getUserSwaps(userId);
    } else {
      // Get all swaps (both pending and completed)
      const pendingSwaps = await swapDataService.getPendingSwaps();
      const completedSwaps = await swapDataService.getSwapsByStatus('COMPLETED');
      const failedSwaps = await swapDataService.getSwapsByStatus('FAILED');
      swaps = [...pendingSwaps, ...completedSwaps, ...failedSwaps];
    }
    
    res.json(swaps.slice(0, parseInt(limit)));
  } catch (error) {
    console.error('Error fetching all swaps:', error);
    res.status(500).json({ error: 'Failed to fetch swaps' });
  }
});

/**
 * Convert technical status to user-friendly description
 */
function getUserFriendlyStatus(status) {
  const statusMap = {
    'INITIALIZED': 'Swap initialized, waiting for deposit',
    'AWAITING_DEPOSIT': 'Waiting for your Bitcoin deposit',
    'DEPOSIT_CONFIRMED': 'Bitcoin deposit confirmed, processing swap',
    'PAYMENT_SENT': 'XMR payment is being sent',
    'PAYMENT_CONFIRMED': 'XMR payment confirmed, finalizing swap',
    'PAYOUT_PUBLISHED': 'Swap payout published',
    'COMPLETED': 'Swap completed successfully',
    'FAILED': 'Swap failed',
    'CANCELED': 'Swap canceled'
  };
  
  return statusMap[status] || 'Unknown status';
}

/**
 * Get next steps based on swap status
 */
function getNextStepsForStatus(status, swapData) {
  switch (status) {
    case 'INITIALIZED':
    case 'AWAITING_DEPOSIT':
      return [`Send exactly ${swapData.depositAmount} BTC to ${swapData.depositAddress}`];
    case 'DEPOSIT_CONFIRMED':
      return ['Bitcoin deposit confirmed, no action needed'];
    case 'PAYMENT_SENT':
      return ['Payment is on the way to your XMR address, no action needed'];
    case 'PAYMENT_CONFIRMED':
      return ['Payment confirmed, finalizing the swap'];
    case 'PAYOUT_PUBLISHED':
      return ['Swap is being finalized'];
    case 'COMPLETED':
      return ['Swap completed! Check your XMR wallet for funds'];
    case 'FAILED':
      return ['Swap failed. Please contact support for assistance.'];
    case 'CANCELED':
      return ['Swap was canceled'];
    default:
      return ['Status unknown'];
  }
}

module.exports = router; 