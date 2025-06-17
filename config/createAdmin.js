require('dotenv').config();
const { Client } = require('@elastic/elasticsearch');
const bcrypt = require('bcryptjs');
// const { elasticClient, ensureUserIndexExists } = require('../helpers/elasticsearch');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be defined in .env file');
}

const client = new Client({
    node: process.env.ELASTICSEARCHHOST,
    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    },
    maxRetries: 5,
    requestTimeout: 60000,
    ssl: {
        rejectUnauthorized: false // Only if you're using self-signed certificates
    }
});

const ensureUserIndexExists = async () => {
    try {
        const indexExists = await client.indices.exists({
            index: 'users'
        });

        if (!indexExists) {
            await client.indices.create({
                index: 'users',
                body: {
                    mappings: {
                        properties: {
                            email: { type: 'keyword' },
                            passwordHash: { type: 'keyword' },
                            isAdmin: { type: 'boolean' },
                            createdAt: { type: 'date' },
                            waitlistStatus: { type: 'keyword' },
                            subscriptionStatus: { type: 'keyword' },
                            paymentMethod: { type: 'keyword' }
                        }
                    }
                }
            });
            console.log('Users index created successfully');
        }
    } catch (error) {
        console.error('Error creating users index:', error);
        throw error;
    }
};

const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise((resolve) => {
        readline.question(question, resolve);
    });
}

(async () => {
    try {
        // Prompt for email and password
        const email = await prompt('Enter admin email: ');
        const password = await prompt('Enter admin password: ');

        readline.close();

        // Ensure the 'users' index exists
        await ensureUserIndexExists();

        // Check if the admin user already exists
        const existingAdmin = await client.search({
            index: 'users',
            body: {
                query: {
                    match: { email: email }
                }
            }
        });

        if (existingAdmin.hits.hits.length > 0) {
            console.log(`Admin user already exists with email: ${email}`);
            return;
        }

        // Hash the password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Define the new admin user data
        const newAdminUser = {
            email: email,
            passwordHash: passwordHash,
            isAdmin: true,
            createdAt: new Date().toISOString(),
            waitlistStatus: 'registered',
            subscriptionStatus: 'inactive',
            paymentMethod: null
        };

        // Store the new user in Elasticsearch
        const response = await client.index({
            index: 'users',
            body: newAdminUser,
            refresh: 'wait_for'
        });

        console.log(`Admin user created with ID: ${response._id}`);

        // Generate a JWT for the new admin
        const token = jwt.sign(
            { 
                userId: response._id, 
                email: email, 
                isAdmin: true 
            }, 
            JWT_SECRET, 
            { expiresIn: '45d' }
        );
        
        console.log('\nJWT Token for admin (valid for testing):');
        console.log(token);
        console.log('\nStore this token securely or login via the interface.');

    } catch (error) {
        console.error('Error creating admin account:', error);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
    } finally {
        process.exit(0);
    }
})();