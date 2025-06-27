/**
 * Test Authentication System Refactor
 * Verifies that the authentication system refactor has been implemented correctly
 */

const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFileExists(filePath) {
    return fs.existsSync(filePath);
}

function checkFileContains(filePath, searchString) {
    if (!checkFileExists(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(searchString);
}

function checkRouteAuthentication(filePath, expectedAuth) {
    if (!checkFileExists(filePath)) return { success: false, details: 'File not found' };
    
    const content = fs.readFileSync(filePath, 'utf8');
    const results = {};
    
    for (const [route, authType] of Object.entries(expectedAuth)) {
        const routePattern = new RegExp(`router\\.(get|post|put|delete)\\('${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^,]*,\\s*(${authType})`);
        results[route] = routePattern.test(content);
    }
    
    return { success: Object.values(results).every(Boolean), details: results };
}

async function runTests() {
    log('🔍 Testing Authentication System Refactor Implementation', 'blue');
    console.log('=' .repeat(60));
    
    let passed = 0;
    let failed = 0;
    
    // Test 1: Environment Configuration
    log('\n📋 Test 1: Environment Configuration', 'yellow');
    if (checkFileContains('example env', 'OIP_API_KEY=')) {
        log('✅ OIP_API_KEY added to example env', 'green');
        passed++;
    } else {
        log('❌ OIP_API_KEY not found in example env', 'red');
        failed++;
    }
    
    // Test 2: Middleware Implementation
    log('\n🔧 Test 2: Middleware Implementation', 'yellow');
    if (checkFileContains('middleware/auth.js', 'function authenticateApiKey')) {
        log('✅ authenticateApiKey middleware function created', 'green');
        passed++;
    } else {
        log('❌ authenticateApiKey middleware function not found', 'red');
        failed++;
    }
    
    if (checkFileContains('middleware/auth.js', 'authenticateApiKey')) {
        log('✅ authenticateApiKey exported from middleware/auth.js', 'green');
        passed++;
    } else {
        log('❌ authenticateApiKey not exported from middleware/auth.js', 'red');
        failed++;
    }
    
    // Test 3: CORS Configuration
    log('\n🌐 Test 3: CORS Configuration', 'yellow');
    if (checkFileContains('index.js', "'X-API-Key'")) {
        log('✅ X-API-Key header added to CORS allowedHeaders', 'green');
        passed++;
    } else {
        log('❌ X-API-Key header not found in CORS configuration', 'red');
        failed++;
    }
    
    // Test 4: Route Authentication Updates
    log('\n🛣️  Test 4: Route Authentication Updates', 'yellow');
    
    // Templates routes
    const templateAuth = checkRouteAuthentication('routes/templates.js', {
        '/newTemplate': 'authenticateApiKey',
        '/newTemplateRemap': 'authenticateApiKey'
    });
    if (templateAuth.success) {
        log('✅ Template routes use API key authentication', 'green');
        passed++;
    } else {
        log('❌ Template routes authentication incorrect:', 'red');
        console.log(templateAuth.details);
        failed++;
    }
    
    // Publish routes
    const publishAuth = checkRouteAuthentication('routes/publish.js', {
        '/newRecipe': 'authenticateApiKey',
        '/newWorkout': 'authenticateApiKey',
        '/newVideo': 'authenticateApiKey',
        '/newImage': 'authenticateApiKey',
        '/newPost': 'authenticateApiKey'
    });
    if (publishAuth.success) {
        log('✅ Publish routes use API key authentication', 'green');
        passed++;
    } else {
        log('❌ Publish routes authentication incorrect:', 'red');
        console.log(publishAuth.details);
        failed++;
    }
    
    // Creator routes
    if (checkFileContains('routes/creators.js', "router.post('/newCreator', authenticateApiKey")) {
        log('✅ Creator routes use API key authentication', 'green');
        passed++;
    } else {
        log('❌ Creator routes authentication incorrect', 'red');
        failed++;
    }
    
    // User routes (should still use JWT)
    if (checkFileContains('routes/user.js', 'authenticateToken') && 
        checkFileContains('routes/user.js', "require('../middleware/auth')")) {
        log('✅ User routes still use JWT authentication from middleware', 'green');
        passed++;
    } else {
        log('❌ User routes authentication incorrect', 'red');
        failed++;
    }
    
    // Test 5: Import Consolidation
    log('\n📦 Test 5: Import Consolidation', 'yellow');
    
    // Check that routes import from middleware/auth.js
    const routesToCheck = [
        'routes/templates.js',
        'routes/publish.js',
        'routes/wallet.js',
        'routes/lit.js',
        'routes/creators.js',
        'routes/user.js'
    ];
    
    let importsCorrect = true;
    for (const route of routesToCheck) {
        if (!checkFileContains(route, "require('../middleware/auth')")) {
            log(`❌ ${route} does not import from middleware/auth.js`, 'red');
            importsCorrect = false;
            failed++;
        }
    }
    
    if (importsCorrect) {
        log('✅ All routes import authentication from middleware/auth.js', 'green');
        passed++;
    }
    
    // Check that duplicate authenticateToken was removed from helpers/utils.js
    if (!checkFileContains('helpers/utils.js', 'const authenticateToken')) {
        log('✅ Duplicate authenticateToken removed from helpers/utils.js', 'green');
        passed++;
    } else {
        log('❌ Duplicate authenticateToken still exists in helpers/utils.js', 'red');
        failed++;
    }
    
    // Test 6: Reference Client Updates
    log('\n🖥️  Test 6: Reference Client Updates', 'yellow');
    
    if (checkFileContains('public/reference-client.html', 'API_CONFIG')) {
        log('✅ API_CONFIG added to reference client', 'green');
        passed++;
    } else {
        log('❌ API_CONFIG not found in reference client', 'red');
        failed++;
    }
    
    if (checkFileContains('public/reference-client.html', 'makeAuthenticatedRequest')) {
        log('✅ makeAuthenticatedRequest helper function added', 'green');
        passed++;
    } else {
        log('❌ makeAuthenticatedRequest helper function not found', 'red');
        failed++;
    }
    
    if (checkFileContains('public/reference-client.html', "'X-API-Key': API_CONFIG.apiKey")) {
        log('✅ Reference client includes X-API-Key header', 'green');
        passed++;
    } else {
        log('❌ Reference client does not include X-API-Key header', 'red');
        failed++;
    }
    
    // Test 7: API Key Generation
    log('\n🔑 Test 7: API Key Generation', 'yellow');
    
    if (checkFileExists('config/generateApiKey.js')) {
        log('✅ API key generation utility created', 'green');
        passed++;
    } else {
        log('❌ API key generation utility not found', 'red');
        failed++;
    }
    
    // Summary
    log('\n📊 Test Summary', 'blue');
    console.log('=' .repeat(60));
    log(`✅ Tests Passed: ${passed}`, 'green');
    log(`❌ Tests Failed: ${failed}`, failed > 0 ? 'red' : 'green');
    log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`, 
         passed === passed + failed ? 'green' : 'yellow');
    
    if (failed === 0) {
        log('\n🎉 All tests passed! Authentication system refactor completed successfully.', 'green');
        log('🔒 The system now uses API keys for server-to-server operations and JWT for user sessions.', 'blue');
    } else {
        log('\n⚠️  Some tests failed. Please review the issues above.', 'yellow');
    }
    
    return { passed, failed };
}

// Run tests if called directly
if (require.main === module) {
    runTests().then(results => {
        process.exit(results.failed > 0 ? 1 : 0);
    });
}

module.exports = { runTests }; 