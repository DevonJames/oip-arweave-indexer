/**
 * Bisq API Wrapper with fallback mock mode
 * Attempts to connect to Bisq daemon and falls back to mock mode if connection fails
 */
const axios = require('axios');

class BisqApi {
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 9998;
    this.password = options.password || 'bisq';
    this.baseUrl = `http://${this.host}:${this.port}`;
    
    // Callbacks for mode changes
    this.mockModeCallbacks = [];
    
    // Track if we're in mock mode
    this.mockMode = options.mockMode || false;
    
    // Track initialization status
    this.initialized = false;
    
    console.log(`Initializing Bisq API client for ${this.baseUrl}`);
    
    // Initialize connection
    this._initConnection();
  }
  
  /**
   * Register a callback for mock mode changes
   * @param {Function} callback - Function to call when mock mode changes
   */
  onMockModeChange(callback) {
    if (typeof callback === 'function') {
      this.mockModeCallbacks.push(callback);
      
      // If already in mock mode, call the callback immediately
      if (this.mockMode) {
        callback(true);
      }
    }
  }
  
  /**
   * Notify all registered callbacks about mock mode change
   * @param {Boolean} enabled - Whether mock mode is enabled
   */
  _notifyMockModeChange(enabled) {
    this.mockModeCallbacks.forEach(callback => {
      try {
        callback(enabled);
      } catch (error) {
        console.warn(`Error in mock mode callback: ${error.message}`);
      }
    });
  }
  
  /**
   * Initialize connection to Bisq daemon
   * @private
   */
  async _initConnection() {
    if (!this.mockMode) {
      try {
        // Test connection with a simple request
        console.log('Testing connection to Bisq daemon...');
        await this.request('GET', 'markets');
        console.log('Successfully connected to Bisq daemon');
        this.initialized = true;
      } catch (error) {
        console.warn(`Failed to connect to Bisq daemon: ${error.message}`);
        console.log('Falling back to mock mode');
        this.mockMode = true;
        this.initialized = true;
        this._notifyMockModeChange(true);
      }
    } else {
      console.log('Starting in mock mode (no real Bisq connection)');
      this.initialized = true;
    }
  }
  
  /**
   * Make authenticated request to the Bisq API
   */
  async request(method, endpoint, data = null) {
    // If we're in mock mode, return mock data
    if (this.mockMode) {
      console.log(`[MOCK] ${method} request to ${endpoint}`);
      return this._getMockResponse(endpoint);
    }
    
    try {
      const url = `${this.baseUrl}/${endpoint}`;
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`bisq:${this.password}`).toString('base64')}`
      };

      console.log(`Making Bisq API request to: ${url}`);
      
      const config = { headers };
      
      let response;
      if (method === 'GET') {
        response = await axios.get(url, config);
      } else if (method === 'POST') {
        response = await axios.post(url, data, config);
      } else if (method === 'PUT') {
        response = await axios.put(url, data, config);
      } else if (method === 'DELETE') {
        response = await axios.delete(url, config);
      }

      console.log(`Bisq API response status: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`Error in Bisq API request: ${error.message}`);
      
      // If this is the first error and it's a protocol error, switch to mock mode
      if (!this.mockMode && 
          (error.message.includes('Parse Error') || 
           error.message.includes('ECONNREFUSED') || 
           error.code === 'HPE_INVALID_CONSTANT')) {
        console.warn('Detected protocol mismatch or connection error, switching to mock mode');
        this.mockMode = true;
        this._notifyMockModeChange(true);
        return this._getMockResponse(endpoint);
      }
      
      throw error;
    }
  }
  
  /**
   * Get mock response data for development/testing
   */
  _getMockResponse(endpoint) {
    // Mock responses for different endpoints
    const mockResponses = {
      'markets': [
        { baseCurrencyCode: 'BTC', counterCurrencyCode: 'USD', minTradeAmount: 0.001, maxTradeAmount: 1.0 },
        { baseCurrencyCode: 'BTC', counterCurrencyCode: 'XMR', minTradeAmount: 0.001, maxTradeAmount: 0.5 },
        { baseCurrencyCode: 'BTC', counterCurrencyCode: 'EUR', minTradeAmount: 0.001, maxTradeAmount: 1.0 }
      ],
      'markets/BTC_XMR/depth': {
        buys: [
          { price: 0.0065, amount: 0.25, numOffers: 3 },
          { price: 0.0063, amount: 0.4, numOffers: 2 }
        ],
        sells: [
          { price: 0.0068, amount: 0.3, numOffers: 2 },
          { price: 0.0070, amount: 0.2, numOffers: 1 }
        ]
      },
      'offers/SELL/XMR': [
        { 
          id: 'offer1', 
          price: 0.0068, 
          minAmount: 0.01, 
          maxAmount: 0.5, 
          txFee: 0.0001
        },
        { 
          id: 'offer2', 
          price: 0.0065, 
          minAmount: 0.005, 
          maxAmount: 0.25, 
          txFee: 0.0001
        }
      ],
      'offers/take': {
        tradeId: 'trade1234',
        depositAddress: 'bc1q3x54tlw0evltfzz4wl0p78t8st5vuxm4x4xt4w',
        depositAmount: 0.01
      },
      'wallets/btc/balance': {
        availableBalance: 1.5432,
        pendingBalance: 0.05,
        reservedBalance: 0.1
      },
      'trades': [
        {
          tradeId: 'trade1234',
          state: 'DEPOSIT_CONFIRMED_IN_BLOCKCHAIN',
          buyerPaymentAccountId: 'acct1',
          sellerPaymentAccountId: 'acct2',
          amount: 0.01,
          price: 0.0065
        }
      ]
    };
    
    // Find the closest matching endpoint
    const matchingEndpoint = Object.keys(mockResponses).find(key => endpoint.includes(key));
    
    return matchingEndpoint ? mockResponses[matchingEndpoint] : { message: 'Not implemented' };
  }
  
  // API methods
  async getMarkets() {
    return this.request('GET', 'markets');
  }
  
  async getMarketDepth(marketCode) {
    return this.request('GET', `markets/${marketCode}/depth`);
  }
  
  async getOffers(direction, currencyCode) {
    return this.request('GET', `offers/${direction}/${currencyCode}`);
  }
  
  async createOffer(offerData) {
    return this.request('POST', 'offers', offerData);
  }
  
  async getWalletBalance() {
    return this.request('GET', 'wallets/btc/balance');
  }
  
  async sendBitcoin(address, amount, description = '') {
    const data = {
      address,
      amount,
      description
    };
    return this.request('POST', 'wallets/btc/send', data);
  }
  
  async getMyAccount() {
    return this.request('GET', 'account');
  }
  
  async getTradeHistory() {
    return this.request('GET', 'trades');
  }
}

module.exports = BisqApi; 