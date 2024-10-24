const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { elasticClient, ensureUserIndexExists } = require('../helpers/elasticsearch');

// JWT secret (should be stored in environment variables in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
const router = express.Router();

// Register endpoint
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Ensure the users index exists
        await ensureUserIndexExists();

        // Check if the user already exists
        const existingUser = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    match: { email: email }
                }
            }
        });

        if (existingUser.hits.hits.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash the password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Store the new user in the Elasticsearch index
        await elasticClient.index({
            index: 'users',
            body: {
                email: email,
                passwordHash: passwordHash,
                createdAt: new Date(),
                subscriptionStatus: 'inactive', // Default subscription status
                paymentMethod: null // Initially, no payment method
            },
            refresh: 'wait_for'
        });

        // Create JWT token for the new user
        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '1h' });

        return res.status(201).json({
            message: 'User registered successfully',
            token // Return the JWT token
        });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Search for the user in Elasticsearch
        const searchResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    match: { email: email }
                }
            }
        });

        if (searchResult.hits.hits.length === 0) {
            return res.status(400).json({ error: 'User not found' });
        }

        const user = searchResult.hits.hits[0]._source;

        // Compare the provided password with the stored hash
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            return res.status(400).json({ error: 'Invalid password' });
        }

        // Authentication successful - Create JWT token
        const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '1h' });

        return res.status(200).json({
            message: 'Login successful',
            token // Return the JWT token
        });
    } catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Middleware to verify the JWT token
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token.' });
        }

        req.user = user; // Store the user info in the request object
        next(); // Proceed to the next middleware or route
    });
}

// Update subscription status (requires authentication)
router.put('/update-subscription', authenticateToken, async (req, res) => {
    try {
        const { subscriptionStatus } = req.body;
        const { email } = req.user;

        // Update the subscription status in Elasticsearch
        const searchResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    match: { email: email }
                }
            }
        });

        if (searchResult.hits.hits.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userId = searchResult.hits.hits[0]._id;

        await elasticClient.update({
            index: 'users',
            id: userId,
            body: {
                doc: { subscriptionStatus: subscriptionStatus }
            },
            refresh: 'wait_for'
        });

        return res.status(200).json({ message: 'Subscription status updated successfully' });
    } catch (error) {
        console.error('Error updating subscription status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update payment method (requires authentication)
router.put('/update-payment', authenticateToken, async (req, res) => {
    try {
        const { paymentMethod } = req.body;
        const { email } = req.user;

        // Update the payment method in Elasticsearch
        const searchResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    match: { email: email }
                }
            }
        });

        if (searchResult.hits.hits.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userId = searchResult.hits.hits[0]._id;

        await elasticClient.update({
            index: 'users',
            id: userId,
            body: {
                doc: { paymentMethod: paymentMethod }
            },
            refresh: 'wait_for'
        });

        return res.status(200).json({ message: 'Payment method updated successfully' });
    } catch (error) {
        console.error('Error updating payment method:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;