require('dotenv').config();
const { Client } = require('@elastic/elasticsearch');
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
        rejectUnauthorized: false
    }
});

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
        const email = await prompt('Enter admin email: ');
        readline.close();

        // Find the admin user
        const response = await client.search({
            index: 'users',
            body: {
                query: {
                    bool: {
                        must: [
                            { match: { email: email } },
                            { match: { isAdmin: true } }
                        ]
                    }
                }
            }
        });

        if (response.hits.hits.length === 0) {
            console.error('No admin user found with that email');
            process.exit(1);
        }

        const user = response.hits.hits[0];
        
        // Generate new token
        const token = jwt.sign(
            {
                userId: user._id,
                email: user._source.email,
                isAdmin: true
            },
            JWT_SECRET,
            { expiresIn: '45d' }
        );

        console.log('\nNew JWT Token for admin:');
        console.log(token);
        console.log('\nStore this token securely.');

    } catch (error) {
        console.error('Error generating token:', error);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
    } finally {
        process.exit(0);
    }
})(); 