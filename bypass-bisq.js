#!/usr/bin/env node

/**
 * Bypass Bisq Launcher
 * This script runs the main OIP Arweave application with the Bisq routes disabled
 * to work around compatibility issues.
 */

// Monkeypatch the express router to ignore Bisq routes
const originalRouter = require('express').Router;
require('express').Router = function() {
  const router = originalRouter.apply(this, arguments);
  
  // Save the original use method
  const originalUse = router.use;
  
  // Override the use method to skip any routes containing 'swap'
  router.use = function(path, ...handlers) {
    if (typeof path === 'string' && path.includes('swap')) {
      console.log(`⚠️ Skipping Bisq routes: ${path}`);
      return router;
    }
    return originalUse.apply(this, [path, ...handlers]);
  };
  
  return router;
};

console.log('⚠️ Starting OIP Arweave with Bisq functionality disabled');
console.log('This is a temporary workaround. The /api/swap endpoints will not be available.');

// Load and run the main application
require('./index.js'); 