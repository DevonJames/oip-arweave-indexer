/**
 * Bisq Swap Wrapper
 * A wrapper around the Bisq API specific to swap functionality
 */
const EventEmitter = require('events');
const BisqApi = require('./bisq-api-wrapper');
const uuid = require('uuid');
const swapDataService = require('../services/swapDataService');
const fs = require('fs');
const path = require('path');

class BisqSwapWrapper extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Determine the host based on environment
    const defaultHost = process.env.RUNNING_IN_DOCKER ? 'bisq' : 'localhost';
    
    this.options = {
      host: options.host || defaultHost,
      port: options.port || 9998,
      password: options.password || 'bisq',
      mockMode: options.mockMode || false
    };
    
    console.log(`Initializing BisqSwapWrapper with host=${this.options.host}, port=${this.options.port}`);
    
    // Initialize Bisq API client
    this.bisqApi = new BisqApi(this.options);
    
    // Register for mock mode changes using the new callback approach
    this.bisqApi.onMockModeChange((enabled) => {
      console.log(`API client switched to mock mode: ${enabled}`);
      this.emit('mock-mode', enabled);
    });
    
    // Map to track active swaps
    this.activeSwaps = new Map();
    
    // Poll interval for status updates (in ms)
    this.pollInterval = options.pollInterval || 30000;
    
    // Initialize polling for swap statuses
    this._initialize();
  }
  
  /**
   * Initialize the wrapper and start polling
   */
  async _initialize() {
    try {
      console.log('Testing connection to Bisq daemon...');
      
      // Try to get markets as a connection test
      try {
        const markets = await this.bisqApi.getMarkets();
        console.log(`Connected successfully. Found ${markets.length} markets.`);
        
        // Start polling
        this._startPolling();
      } catch (error) {
        console.warn(`Warning: Could not connect to Bisq daemon: ${error.message}`);
        console.log('Continuing in mock mode. Swap functionality will be simulated.');
        
        // Start polling anyway (will use mock data)
        this._startPolling();
      }
    } catch (error) {
      console.error(`Failed to initialize BisqSwapWrapper: ${error.message}`);
    }
  }
  
  /**
   * Start polling for swap status updates
   */
  _startPolling() {
    console.log(`Starting swap status polling (every ${this.pollInterval/1000} seconds)`);
    
    // Set up interval to poll for swap status updates
    setInterval(async () => {
      try {
        const pendingSwaps = await this.listPendingSwaps();
        
        if (pendingSwaps.length > 0) {
          console.log(`Checking status for ${pendingSwaps.length} pending swaps...`);
          
          for (const swap of pendingSwaps) {
            try {
              await this.getSwapStatus(swap.id);
            } catch (error) {
              console.error(`Error updating swap ${swap.id}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        console.error(`Error in swap status polling: ${error.message}`);
      }
    }, this.pollInterval);
  }
  
  /**
   * Initialize a new swap
   * @param {Object} swapDetails - Details about the swap
   * @return {Object} Swap initialization result
   */
  async initializeSwap(swapDetails) {
    try {
      console.log('Initializing swap with details:', swapDetails);
      
      // Validate swap details
      this._validateSwapDetails(swapDetails);
      
      // Generate a unique ID for this swap
      const swapId = uuid.v4();
      
      // Get available offers for this trading pair
      let offers;
      try {
        offers = await this.bisqApi.getOffers(
          swapDetails.direction || 'SELL', 
          swapDetails.toCurrency
        );
        console.log(`Found ${offers.length} offers for ${swapDetails.toCurrency}`);
      } catch (error) {
        console.error(`Error fetching offers: ${error.message}`);
        throw new Error(`Could not fetch offers for ${swapDetails.fromCurrency} to ${swapDetails.toCurrency}`);
      }
      
      // Find a suitable offer
      const validOffer = this._findValidOffer(offers, swapDetails);
      
      if (!validOffer) {
        throw new Error(`No suitable offers found for ${swapDetails.fromCurrency} to ${swapDetails.toCurrency} with the requested amount`);
      }
      
      console.log(`Selected offer: ${validOffer.id} with price ${validOffer.price}`);
      
      // Take the offer to initialize the swap
      let tradeResult;
      try {
        tradeResult = await this.bisqApi.request('POST', 'offers/take', {
          offerId: validOffer.id,
          amount: swapDetails.amount,
          paymentAccountId: swapDetails.paymentAccountId || 'default'
        });
      } catch (error) {
        console.error(`Error taking offer: ${error.message}`);
        throw new Error(`Failed to take offer: ${error.message}`);
      }
      
      // Create a new swap object
      const swap = {
        id: swapId,
        tradeId: tradeResult.tradeId,
        status: 'INITIALIZED',
        details: swapDetails,
        offer: validOffer,
        depositAddress: tradeResult.depositAddress,
        depositAmount: tradeResult.depositAmount,
        createdAt: new Date(),
        updatedAt: new Date(),
        logs: [{
          time: new Date(),
          status: 'INITIALIZED',
          message: 'Swap initialized successfully'
        }]
      };
      
      // Save swap to database
      try {
        await swapDataService.saveSwap(swap);
      } catch (error) {
        console.error(`Error saving swap to database: ${error.message}`);
        // Continue anyway, just store in memory
      }
      
      // Store in memory also
      this.activeSwaps.set(swapId, swap);
      
      // Emit the initialized event
      this.emit('swap:initialized', { swapId, swap });
      
      // Return initialization details
      return {
        swapId,
        depositAddress: tradeResult.depositAddress,
        depositAmount: tradeResult.depositAmount,
        expectedRate: validOffer.price,
        estimatedCompletionTime: this._estimateCompletionTime(swapDetails),
        status: 'INITIALIZED'
      };
    } catch (error) {
      console.error(`Swap initialization failed: ${error.message}`);
      
      // Emit failed event
      this.emit('swap:failed', {
        reason: error.message,
        details: swapDetails
      });
      
      // Re-throw error
      throw error;
    }
  }
  
  /**
   * Find a valid offer matching the swap requirements
   * @private
   */
  _findValidOffer(offers, swapDetails) {
    return offers.find(offer => {
      const amountOk = offer.minAmount <= swapDetails.amount && 
                       offer.maxAmount >= swapDetails.amount;
      
      const priceOk = !swapDetails.maxPrice || offer.price <= swapDetails.maxPrice;
      
      return amountOk && priceOk;
    });
  }
  
  /**
   * Estimate completion time based on swap details
   * @private
   */
  _estimateCompletionTime(swapDetails) {
    // Base time plus extra for different currencies
    const baseMinutes = 60; // 1 hour base time
    let additionalMinutes = 0;
    
    if (swapDetails.toCurrency === 'XMR') {
      additionalMinutes = 30; // Monero takes longer
    }
    
    return new Date(Date.now() + (baseMinutes + additionalMinutes) * 60 * 1000);
  }
  
  /**
   * Validate swap details
   * @private
   */
  _validateSwapDetails(swapDetails) {
    const requiredFields = ['fromCurrency', 'toCurrency', 'amount'];
    
    for (const field of requiredFields) {
      if (!swapDetails[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    if (swapDetails.fromCurrency !== 'BTC') {
      throw new Error('Currently only BTC is supported as the source currency');
    }
    
    if (swapDetails.amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }
    
    // Check for XMR address if needed
    if (swapDetails.toCurrency === 'XMR' && !swapDetails.toAddress) {
      throw new Error('Monero receiving address is required for BTC to XMR swaps');
    }
  }
  
  /**
   * Get status of a specific swap
   * @param {string} swapId - ID of the swap to check
   * @return {Object} Current swap status
   */
  async getSwapStatus(swapId) {
    try {
      // Try to get swap from database first
      let swap;
      try {
        swap = await swapDataService.getSwapById(swapId);
      } catch (error) {
        console.warn(`Could not retrieve swap from database: ${error.message}`);
      }
      
      // If not in database, try memory
      if (!swap) {
        swap = this.activeSwaps.get(swapId);
      }
      
      if (!swap) {
        throw new Error(`Swap ${swapId} not found`);
      }
      
      // If the swap has a trade ID, get the latest status
      if (swap.tradeId) {
        try {
          const tradeDetails = await this.bisqApi.request('GET', `trades/${swap.tradeId}`);
          
          // Map Bisq status to our status
          const newStatus = this._mapBisqStatus(tradeDetails.state);
          
          // If status has changed, update records
          if (swap.status !== newStatus) {
            const now = new Date();
            
            // Create log entry
            const logEntry = {
              time: now,
              status: newStatus,
              message: `Status updated to ${newStatus}`
            };
            
            // Update swap object
            swap.status = newStatus;
            swap.updatedAt = now;
            swap.logs = [...(swap.logs || []), logEntry];
            
            // Save to database if possible
            try {
              await swapDataService.updateSwap(swapId, {
                status: newStatus,
                updatedAt: now,
                logs: [logEntry]
              });
            } catch (error) {
              console.warn(`Could not update swap in database: ${error.message}`);
            }
            
            // Update in memory
            this.activeSwaps.set(swapId, swap);
            
            // Emit events based on status
            if (newStatus === 'COMPLETED') {
              this.emit('swap:completed', { swapId, swap });
            } else if (['FAILED', 'CANCELED'].includes(newStatus)) {
              this.emit('swap:failed', { 
                swapId, 
                reason: newStatus, 
                swap 
              });
            } else {
              this.emit('swap:statusChanged', { 
                swapId, 
                status: newStatus, 
                swap 
              });
            }
          }
        } catch (error) {
          console.error(`Error getting trade details: ${error.message}`);
          // Return the last known status in case of error
        }
      }
      
      // Return the (possibly updated) swap
      return swap;
    } catch (error) {
      console.error(`Error getting swap status: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Map Bisq status to our status
   * @private
   */
  _mapBisqStatus(bisqStatus) {
    const statusMap = {
      'PREPARATION': 'INITIALIZED',
      'TAKER_PUBLISHED_DEPOSIT_TX': 'AWAITING_DEPOSIT',
      'DEPOSIT_CONFIRMED_IN_BLOCKCHAIN': 'DEPOSIT_CONFIRMED',
      'BUYER_SENT_PAYMENT_SENT_MSG': 'PAYMENT_SENT',
      'SELLER_CONFIRMED_PAYMENT_RECEIPT': 'PAYMENT_CONFIRMED',
      'PAYOUT_PUBLISHED': 'PAYOUT_PUBLISHED',
      'COMPLETED': 'COMPLETED',
      'FAILED': 'FAILED',
      'CLOSED': 'CANCELED'
    };
    
    return statusMap[bisqStatus] || 'UNKNOWN';
  }
  
  /**
   * Get all pending swaps
   * @return {Array} Array of pending swaps
   */
  async listPendingSwaps() {
    try {
      return await swapDataService.getPendingSwaps();
    } catch (error) {
      console.error(`Error listing pending swaps: ${error.message}`);
      
      // If database fails, return from memory
      return Array.from(this.activeSwaps.values())
        .filter(swap => !['COMPLETED', 'FAILED', 'CANCELED'].includes(swap.status));
    }
  }
  
  /**
   * Get all completed swaps
   * @return {Array} Array of completed swaps
   */
  async listCompletedSwaps() {
    try {
      return await swapDataService.getSwapsByStatus('COMPLETED');
    } catch (error) {
      console.error(`Error listing completed swaps: ${error.message}`);
      
      // If database fails, return from memory
      return Array.from(this.activeSwaps.values())
        .filter(swap => swap.status === 'COMPLETED');
    }
  }
  
  /**
   * Attempt to cancel a swap
   * @param {string} swapId - ID of swap to cancel
   * @return {Object} Result of cancellation attempt
   */
  async cancelSwap(swapId) {
    try {
      // Get current swap
      const swap = await this.getSwapStatus(swapId);
      
      if (!swap) {
        throw new Error(`Swap ${swapId} not found`);
      }
      
      // Check if the swap can be canceled (only in early stages)
      const cancelableStates = ['INITIALIZED', 'AWAITING_DEPOSIT'];
      if (!cancelableStates.includes(swap.status)) {
        throw new Error(`Cannot cancel swap in ${swap.status} state`);
      }
      
      // Try to cancel through Bisq API
      if (swap.tradeId) {
        try {
          await this.bisqApi.request('POST', `trades/${swap.tradeId}/cancel`);
        } catch (error) {
          console.warn(`Bisq API cancel failed: ${error.message}`);
          // Continue anyway, we'll mark it as canceled in our system
        }
      }
      
      // Update status to canceled
      const now = new Date();
      const logEntry = {
        time: now,
        status: 'CANCELED',
        message: 'Swap canceled by user'
      };
      
      // Update in database
      try {
        await swapDataService.updateSwap(swapId, {
          status: 'CANCELED',
          updatedAt: now,
          logs: [logEntry]
        });
      } catch (error) {
        console.warn(`Could not update swap in database: ${error.message}`);
      }
      
      // Update in memory
      if (this.activeSwaps.has(swapId)) {
        const memSwap = this.activeSwaps.get(swapId);
        memSwap.status = 'CANCELED';
        memSwap.updatedAt = now;
        memSwap.logs = [...(memSwap.logs || []), logEntry];
        this.activeSwaps.set(swapId, memSwap);
      }
      
      // Emit event
      this.emit('swap:canceled', { swapId, swap: { ...swap, status: 'CANCELED' } });
      
      return {
        swapId,
        status: 'CANCELED',
        message: 'Swap canceled successfully'
      };
    } catch (error) {
      console.error(`Error canceling swap: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get metrics about swaps
   * @return {Object} Swap metrics
   */
  async getMetrics() {
    try {
      return await swapDataService.getSwapMetrics();
    } catch (error) {
      console.error(`Error getting swap metrics: ${error.message}`);
      
      // If database fails, calculate from memory
      const swaps = Array.from(this.activeSwaps.values());
      const completed = swaps.filter(swap => swap.status === 'COMPLETED');
      const failed = swaps.filter(swap => ['FAILED', 'CANCELED'].includes(swap.status));
      
      // Calculate total volume
      const totalVolumeBTC = completed.reduce((sum, swap) => {
        return sum + parseFloat(swap.details.amount || 0);
      }, 0).toFixed(8);
      
      // Calculate average completion time
      let avgCompletionTimeMinutes = 0;
      if (completed.length > 0) {
        const totalMinutes = completed.reduce((sum, swap) => {
          const startTime = new Date(swap.createdAt).getTime();
          const endTime = new Date(swap.updatedAt).getTime();
          return sum + (endTime - startTime) / (1000 * 60);
        }, 0);
        
        avgCompletionTimeMinutes = (totalMinutes / completed.length).toFixed(2);
      }
      
      return {
        totalSwaps: swaps.length,
        completedSwaps: completed.length,
        failedSwaps: failed.length,
        totalVolumeBTC,
        avgCompletionTimeMinutes
      };
    }
  }
}

module.exports = BisqSwapWrapper; 