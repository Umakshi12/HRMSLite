import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error('JWT_SECRET is required in backend .env');
} else {
  console.log(`[Auth] JWT_SECRET loaded (length: ${SECRET.length})`);
}

export const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

export const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

export const generateToken = (user) => {
  return jwt.sign(
    { 
      login_id: user.login_id, 
      identifier: user.identifier, 
      role: user.role,
      tenant_id: user.tenant_id,
      sheet_access: user.sheet_access 
    },
    SECRET,
    { expiresIn: '8h' }
  );
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    console.error(`[Auth] Token verification failed: ${err.message}`);
    return null;
  }
};
