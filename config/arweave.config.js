// Arweave configuration with local AR.IO gateway support
// Uses local AR.IO gateway when enabled for Arweave client initialization
// Note: Application-level code (GraphQL queries, HTTP requests) automatically falls back to arweave.net
// if the local gateway is unavailable - see helpers/arweave.js and helpers/elasticsearch.js
const useLocalGateway = process.env.ARIO_GATEWAY_ENABLED === 'true';
const gatewayHost = process.env.ARIO_GATEWAY_HOST || 'http://ario-gateway:4000';

let config;

if (useLocalGateway) {
    // Parse the gateway host URL to extract host, port, and protocol
    try {
        const url = new URL(gatewayHost);
        config = {
            host: url.hostname,
            port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
            protocol: url.protocol.replace(':', ''), // Remove trailing colon
            timeout: 20000,
            logging: false,
        };
        console.log(`✅ Using local AR.IO gateway: ${gatewayHost}`);
    } catch (error) {
        console.warn(`⚠️  Invalid ARIO_GATEWAY_HOST format, falling back to arweave.net: ${error.message}`);
        config = {
            host: 'arweave.net',
            port: 443,
            protocol: 'https',
            timeout: 20000,
            logging: false,
        };
    }
} else {
    config = {
        host: 'arweave.net',
        port: 443,
        protocol: 'https',
        timeout: 20000,
        logging: false,
    };
}

module.exports = config;