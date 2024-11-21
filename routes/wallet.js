const express = require('express');
const router = express.Router();
const { upfrontFunding, lazyFunding, checkBalance } = require('../helpers/arweave');

// Endpoint to check wallet balance
router.get('/checkbalance', async (req, res) => {
    console.log('GET /api/wallet/checkbalance');
    try {
        const balance = await checkBalance();
        console.log('Balance retrieved successfully:', balance);
        res.status(200).json({ balance });
    } catch (error) {
        console.error('Error retrieving balance:', error);
        res.status(500).json({ error: 'Failed to retrieve balance' });
    }
});

// Endpoint to fund wallet with a specific amount upfront
router.post('/fund/upfront', async (req, res) => {
    console.log('POST /api/wallet/fund/upfront');
    const { amount, multiplier } = req.body;
    try {
        const response = await upfrontFunding(amount, multiplier || 1); // Default multiplier is 1 if not provided
        console.log('Upfront funding successful:', response);
        res.status(200).json({ message: 'Upfront funding successful', response });
    } catch (error) {
        console.error('Error during upfront funding:', error);
        res.status(500).json({ error: 'Upfront funding failed' });
    }
});

// Endpoint to fund wallet lazily based on data size
router.post('/fund/lazy', async (req, res) => {
    console.log('POST /api/wallet/fund/lazy');
    const { size, multiplier } = req.body;
    try {
        const response = await lazyFunding(size, multiplier || 1); // Default multiplier is 1 if not provided
        console.log('Lazy funding successful:', response);
        res.status(200).json({ message: 'Lazy funding successful', response });
    } catch (error) {
        console.error('Error during lazy funding:', error);
        res.status(500).json({ error: 'Lazy funding failed' });
    }
});

module.exports = router;