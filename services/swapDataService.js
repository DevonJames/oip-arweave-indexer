/**
 * Swap Data Service
 * Handles persistence of swap data in ElasticSearch
 */
const { Client } = require('@elastic/elasticsearch');
const { v4: uuidv4 } = require('uuid');

// Initialize ElasticSearch client
let client;
async function getElasticClient() {
  if (!client) {
    // When running locally (not in Docker), use localhost instead of the service name
    const isDocker = process.env.RUNNING_IN_DOCKER === 'true';
    const elasticHost = isDocker 
      ? process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200'
      : 'http://localhost:9200';
    
    console.log(`Connecting to ElasticSearch at: ${elasticHost}`);
    
    client = new Client({
      node: elasticHost,
      auth: {
        username: process.env.ELASTICCLIENTUSERNAME || '',
        password: process.env.ELASTICCLIENTPASSWORD || ''
      }
    });
  }
  return client;
}

class SwapDataService {
  constructor() {
    this.indexName = 'swaps';
  }

  /**
   * Save a new swap to the database
   * @param {Object} swapData - Swap data object to save
   * @returns {Object} - Saved swap with ID
   */
  async saveSwap(swapData) {
    const client = await getElasticClient();
    
    // Ensure swapId exists or generate one
    const swapId = swapData.swapId || swapData.id || uuidv4();
    const now = new Date();
    
    // Prepare the document
    const doc = {
      swapId,
      status: swapData.status,
      fromCurrency: swapData.details?.fromCurrency,
      toCurrency: swapData.details?.toCurrency,
      fromAmount: swapData.details?.fromAmount,
      toAmount: swapData.details?.toAmount,
      depositAddress: swapData.depositAddress,
      depositAmount: swapData.depositAmount,
      toAddress: swapData.details?.toAddress,
      userId: swapData.details?.customData?.userId,
      tradeId: swapData.tradeId,
      expectedRate: swapData.offer?.price,
      created: swapData.createdAt || now,
      updated: swapData.updatedAt || now,
      logs: swapData.logs || [{
        time: now,
        status: swapData.status,
        message: 'Swap initialized'
      }],
      customData: swapData.customData || swapData.details?.customData || {}
    };
    
    // Save to ElasticSearch
    await client.index({
      index: this.indexName,
      id: swapId,
      body: doc,
      refresh: true // Make the document immediately searchable
    });
    
    return { ...doc, id: swapId };
  }

  /**
   * Update an existing swap
   * @param {String} swapId - ID of swap to update
   * @param {Object} updates - Fields to update
   * @returns {Object} - Updated swap
   */
  async updateSwap(swapId, updates) {
    const client = await getElasticClient();
    const now = new Date();
    
    // Get current swap
    const currentSwap = await this.getSwapById(swapId);
    if (!currentSwap) {
      throw new Error(`Swap with ID ${swapId} not found`);
    }
    
    // Prepare update document
    const updateDoc = {
      ...updates,
      updated: now
    };
    
    // Handle special case for logs - append instead of replace
    if (updates.logs) {
      updateDoc.logs = [...(currentSwap.logs || []), ...updates.logs];
    }
    
    // Update in ElasticSearch
    await client.update({
      index: this.indexName,
      id: swapId,
      body: {
        doc: updateDoc
      },
      refresh: true
    });
    
    return this.getSwapById(swapId);
  }

  /**
   * Get a swap by its ID
   * @param {String} swapId - ID of swap to retrieve
   * @returns {Object|null} - Swap data or null if not found
   */
  async getSwapById(swapId) {
    const client = await getElasticClient();
    
    try {
      const response = await client.get({
        index: this.indexName,
        id: swapId
      });
      
      return response._source;
    } catch (error) {
      if (error.meta?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all swaps for a user
   * @param {String} userId - User ID
   * @returns {Array} - Array of swaps
   */
  async getUserSwaps(userId) {
    const client = await getElasticClient();
    
    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          match: {
            userId: userId
          }
        },
        sort: [
          { created: { order: 'desc' } }
        ],
        size: 100
      }
    });
    
    return response.hits.hits.map(hit => hit._source);
  }

  /**
   * Get swaps by status
   * @param {String} status - Status to filter by
   * @returns {Array} - Array of swaps
   */
  async getSwapsByStatus(status) {
    const client = await getElasticClient();
    
    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          match: {
            status: status
          }
        },
        sort: [
          { created: { order: 'desc' } }
        ],
        size: 100
      }
    });
    
    return response.hits.hits.map(hit => hit._source);
  }

  /**
   * Get all pending swaps
   * @returns {Array} - Array of pending swaps
   */
  async getPendingSwaps() {
    const client = await getElasticClient();
    
    const pendingStatuses = [
      'INITIALIZED', 
      'AWAITING_DEPOSIT', 
      'DEPOSIT_CONFIRMED', 
      'PAYMENT_SENT', 
      'PAYMENT_CONFIRMED', 
      'COMPLETING'
    ];
    
    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          terms: {
            status: pendingStatuses
          }
        },
        sort: [
          { created: { order: 'desc' } }
        ],
        size: 100
      }
    });
    
    return response.hits.hits.map(hit => hit._source);
  }

  /**
   * Get swap metrics and statistics
   * @returns {Object} - Swap metrics
   */
  async getSwapMetrics() {
    const client = await getElasticClient();
    
    // Get count of swaps by status
    const statusAgg = await client.search({
      index: this.indexName,
      body: {
        size: 0,
        aggs: {
          statuses: {
            terms: {
              field: 'status'
            }
          },
          pairs: {
            terms: {
              script: "doc['fromCurrency'].value + '_' + doc['toCurrency'].value"
            }
          },
          totalBtcVolume: {
            sum: {
              field: 'fromAmount',
              script: {
                source: "doc['fromCurrency'].value == 'BTC' ? doc['fromAmount'].value : 0"
              }
            }
          },
          avgCompletionTime: {
            avg: {
              script: {
                source: "if (doc['completed'].size() > 0 && doc['created'].size() > 0) { return (doc['completed'].value.toInstant().toEpochMilli() - doc['created'].value.toInstant().toEpochMilli()) / 60000 } else { return null }"
              }
            }
          }
        }
      }
    });
    
    // Process aggregation results
    const metrics = {
      totalSwaps: statusAgg.hits.total.value,
      swapsByStatus: {},
      swapsByPair: {},
      totalBtcVolume: statusAgg.aggregations.totalBtcVolume.value,
      avgCompletionTimeMinutes: statusAgg.aggregations.avgCompletionTime.value
    };
    
    // Process status buckets
    statusAgg.aggregations.statuses.buckets.forEach(bucket => {
      metrics.swapsByStatus[bucket.key] = bucket.doc_count;
    });
    
    // Process pairs buckets
    statusAgg.aggregations.pairs.buckets.forEach(bucket => {
      metrics.swapsByPair[bucket.key] = bucket.doc_count;
    });
    
    return metrics;
  }
}

module.exports = new SwapDataService(); 