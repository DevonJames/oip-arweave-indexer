/**
 * Authentication Middleware
 * Verifies JWT tokens for protected routes
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // Should be in .env file

/**
 * Middleware to authenticate JWT token
 */
function authenticateToken(req, res, next) {
  // Get auth header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Split 'Bearer TOKEN'
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication token required' });
  }
  
  // Verify token
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Forbidden', message: 'Invalid or expired token' });
    }
    
    // If verified, set user in request
    req.user = user;
    next();
  });
}

/**
 * Middleware to authenticate API key
 */
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'API key required' 
    });
  }
  
  if (apiKey !== process.env.OIP_API_KEY) {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Invalid API key' 
    });
  }
  
  next();
}

/**
 * Middleware to check if user is an admin
 */
function isAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }
  
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin privileges required' });
  }
  
  next();
}

/**
 * Optional authentication - populate user if token exists, but don't require it
 */
function optionalAuth(req, res, next) {
  // Get auth header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Split 'Bearer TOKEN'
  
  if (!token) {
    return next(); // Continue without authentication
  }
  
  // Verify token
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (!err) {
      // If verified, set user in request
      req.user = user;
    }
    next();
  });
}

module.exports = {
  authenticateToken,
  authenticateApiKey,
  isAdmin,
  optionalAuth
}; 