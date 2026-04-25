import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import apiRoutes from './routes.js';

dotenv.config();

const app = express();

// Fix Vercel internal routing by rewriting URL
app.use((req, res, next) => {
  if (req.url.startsWith('/backend/server.js')) {
    req.url = req.url.replace('/backend/server.js', '/api');
  }
  next();
});

const PORT = process.env.PORT || 5000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

if (!process.env.JWT_SECRET) {
  throw new Error('Missing required env: JWT_SECRET');
}
if (process.env.JWT_SECRET === 'staffurs_super_secret_key_change_me_in_prod') {
  console.warn('[SECURITY] JWT_SECRET is using a default value. Set a strong random secret in production.');
}
if (!process.env.SPREADSHEET_ID || (!process.env.GOOGLE_CREDENTIALS_PATH && !process.env.GOOGLE_CREDENTIALS_JSON)) {
  console.warn('[CONFIG] Google Sheets env vars are missing. Data routes will fail until configured.');
}

// Middleware
app.use(helmet());
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json());
app.use(morgan('dev'));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Staffurs HRMS Backend is running smoothly!' });
});

// API Routes
app.use('/api', apiRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' ? { error: err.message } : {}),
  });
});

// Start Server (only if not running in a Vercel serverless environment)
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
  });
}

export default app;
