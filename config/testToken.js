require('dotenv').config();
const jwt = require('jsonwebtoken');

console.log('JWT_SECRET:', process.env.JWT_SECRET);
const token = jwt.sign(
    { 
        userId: 'test',
        email: 'test@test.com',
        isAdmin: true 
    },
    process.env.JWT_SECRET,
    { expiresIn: '45d' }
);

console.log('\nGenerated Token:', token);

try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    console.log('\nVerification successful:', verified);
} catch (error) {
    console.error('\nVerification failed:', error);
} 