/**
 * Memory Tracking Middleware
 * 
 * Wraps Express routes to track memory usage per request
 * Safe and lightweight - only tracks when diagnostics are enabled
 */

const memoryDiagnostics = require('../helpers/memoryDiagnostics');

/**
 * Middleware to track memory growth for each HTTP request
 */
function trackRequestMemory(req, res, next) {
    if (!memoryDiagnostics.enabled) {
        return next();
    }
    
    // Capture request details
    const operationType = `${req.method} ${req.path}`;
    const operationDetails = req.query ? JSON.stringify(req.query).substring(0, 100) : '';
    
    // Start tracking
    const endTracking = memoryDiagnostics.trackOperation(operationType, operationDetails);
    
    // Hook into response finish event
    const originalEnd = res.end;
    res.end = function(...args) {
        // Call original end
        originalEnd.apply(res, args);
        
        // Track memory after response is sent
        setImmediate(endTracking);
    };
    
    next();
}

module.exports = { trackRequestMemory };

