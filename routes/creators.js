// routes/creators.js
const express = require('express');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config();

const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    }
});

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const creators = await elasticClient.search({
            index: 'creatorregistrations',
            body: {
                query: {
                    match_all: {}
                }
            }
        });
        res.status(200).json({ creators: creators.hits.hits });
    } catch (error) {
        console.error('Error retrieving creators:', error);
        res.status(500).json({ error: 'Failed to retrieve creators' });
    }
});

module.exports = router;