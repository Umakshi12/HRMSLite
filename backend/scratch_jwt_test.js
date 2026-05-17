import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: './.env' });

const SECRET = process.env.JWT_SECRET;
console.log('Secret:', SECRET);

const user = { login_id: 'test', role: 'admin' };
const token = jwt.sign(user, SECRET, { expiresIn: '8h' });
console.log('Generated Token:', token);

try {
    const decoded = jwt.verify(token, SECRET);
    console.log('Decoded:', decoded);
    console.log('Verification Success!');
} catch (err) {
    console.error('Verification Failed:', err.message);
}
