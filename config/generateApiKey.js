const crypto = require('crypto');

/**
 * Generate a secure API key for OIP authentication
 * @returns {string} Secure API key
 */
function generateSecureApiKey() {
    // Generate 32 bytes of random data and convert to hex
    const randomBytes = crypto.randomBytes(32);
    const apiKey = randomBytes.toString('hex');
    return apiKey;
}

// If run directly, generate and print an API key
if (require.main === module) {
    const apiKey = generateSecureApiKey();
    console.log('Generated OIP API Key:');
    console.log(apiKey);
    console.log('\nAdd this to your .env file:');
    console.log(`OIP_API_KEY=${apiKey}`);
}

module.exports = { generateSecureApiKey }; 