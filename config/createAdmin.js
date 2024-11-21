const { Client } = require('@elastic/elasticsearch');
const bcrypt = require('bcrypt');
// const { elasticClient, ensureUserIndexExists } = require('../helpers/elasticsearch');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://0.0.0.0:9200',

    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    }
});

const ensureUserIndexExists = async () => {
    try {
        const indexExists = await elasticClient.indices.exists({ index: 'users' });
        console.log(`Index exists check for 'users':`, indexExists.body);  // Log existence check result
        
        if (!indexExists.body) {
            await elasticClient.indices.create({
                index: 'users',
                body: {
                    mappings: {
                        properties: {
                            email: { type: 'text' },
                            passwordHash: { type: 'text' },
                            subscriptionStatus: { type: 'text' },
                            paymentMethod: { type: 'text' },
                            createdAt: { type: 'date' },
                            isAdmin: { type: 'boolean' }
                        }
                    }
                }
            });
            console.log('Users index created successfully.');
        } else {
            console.log('Users index already exists, skipping creation.');
        }
    } catch (error) {
        if (error.meta && error.meta.body && error.meta.body.error && error.meta.body.error.type === 'resource_already_exists_exception') {
            console.log('Users index already exists (caught in error).');
        } else {
            console.error('Error creating users index:', error);
        }
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
        const existingAdmin = await elasticClient.search({
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
            createdAt: new Date().toISOString(),
            waitlistStatus: 'registered',
            subscriptionStatus: 'inactive', // Default subscription status
            paymentMethod: null, // Initially, no payment method
            isAdmin: true // Set the user as admin
        };

        // Store the new user in Elasticsearch
        const response = await elasticClient.index({
            index: 'users',
            body: newAdminUser,
            refresh: 'wait_for'
        });

        console.log(`Admin user created with ID: ${response._id}`);

        // Optional: Generate a JWT for the new admin (useful for testing)
        const token = jwt.sign({ userId: response._id, email: email, isAdmin: true }, JWT_SECRET, { expiresIn: '45d' });
        console.log(`JWT Token for admin (valid for testing): ${token}`);
        console.log("Store this token securely or login via the interface.");

    } catch (error) {
        console.error('Error creating admin account:', error);
    }
})();