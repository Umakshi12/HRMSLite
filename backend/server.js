import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import apiRoutes from './routes.js';
import db from './db.js';
import prisma from './prisma/client.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);

// COOKIE PARSER (since we removed the dependency to stay lean)
app.use((req, res, next) => {
  const list = {};
  const rc = req.headers.cookie;

  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const name = parts.shift().trim();
      const value = parts.join('=');
      try {
        list[name] = decodeURIComponent(value);
      } catch (e) {
        list[name] = value;
      }
    });
  }

  req.cookies = list;
  next();
});

// Fix Vercel internal routing by rewriting URL
app.use((req, res, next) => {
  if (req.url.startsWith('/backend/server.js')) {
    req.url = req.url.replace('/backend/server.js', '/api');
  }
  next();
});

const PORT = process.env.PORT || 5000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://hrms-lite-inky-psi.vercel.app';

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
app.use(hpp());

// Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: (req) => req.path === '/health' || req.path === '/',
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Specific limiter for authentication
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Specific limiter for bulk operations
const importLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { success: false, message: 'Bulk import limit reached. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Specific limiter for AI resources
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'AI search quota exceeded. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Routes are mounted at both /api and / (Vercel prefix stripping),
// so limiters must cover both path variants or they can be bypassed.
app.use(globalLimiter);
app.use(['/api/login', '/login'], loginLimiter);
app.use(['/api/import', '/import'], importLimiter);
app.use(['/api/ai-search', '/ai-search'], aiLimiter);
app.use(['/api/bulk-import', '/bulk-import'], importLimiter);

// CORS — allow local dev, explicitly configured origin, and Vercel preview deployments
const allowedOrigins = new Set(
  [ALLOWED_ORIGIN, process.env.FRONTEND_URL].filter(Boolean)
);
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // same-origin / non-browser
    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
    const isAllowed = allowedOrigins.has(origin);
    const isVercel = origin.endsWith('.vercel.app');
    if (isLocal || isAllowed || isVercel) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
};

app.use(cors(corsOptions));

// Body Parser with limits to prevent DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}
app.use(morgan('dev'));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'SheetSync Pro Backend is running smoothly!' });
});

app.get('/', (req, res) => {
  res.send('🚀 SheetSync Pro API is running! Go to the dashboard to start syncing.');
});


// API Routes
app.use('/api', apiRoutes);
app.use('/', apiRoutes); // Add this to handle Vercel's stripped /api prefix

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' ? { error: err.message } : {}),
  });
});

// Auto-seed: create default super admin if no super_admin exists in DB
async function ensureSuperAdmin() {
  try {
    const { default: bcrypt } = await import('bcryptjs');
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'superadmin@sheetsync.pro';
    const loginId = process.env.BOOTSTRAP_ADMIN_LOGIN_ID || 'superadmin_root';
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Admin@123456';
    const hash = await bcrypt.hash(password, 12);

    await prisma.user.upsert({
      where: { identifier: email },
      update: { password: hash, login_id: loginId },
      create: {
        login_id: loginId,
        name: 'Super Admin',
        identifier: email,
        password: hash,
        role: 'super_admin',
        plan: 'pro',
        status: 'active',
        max_user_quota: 9999,
        created_by: 'system',
      }
    });
    console.log(`[Seed] Super Admin ensured — email: ${email}`);
  } catch (e) {
    console.error('[Seed] Failed to ensure super admin:', e.message);
  }
}

// ── Module-level initialization (runs on both local and Vercel cold starts) ──
// ensureSuperAdmin must NOT be inside app.listen() because Vercel serverless
// never calls listen() — the app is exported directly as a handler.
(async () => {
  try {
    await ensureSuperAdmin();
    await db.autoRegisterPrimarySheets();
  } catch (e) {
    console.error('[Init] Startup initialization failed:', e.message);
  }
})();

// Start Server (only if not running in a Vercel serverless environment)
let server;
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  server = app.listen(PORT, async () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);

    // Start background sync locally every 15 minutes
    const SYNC_INTERVAL = 15 * 60 * 1000;
    setInterval(async () => {
      console.log('[Background] Running scheduled spreadsheet sync...');
      await db.syncAllActiveSpreadsheets();
    }, SYNC_INTERVAL);

    // DATA POLICY: daily purge of cached rows from disconnected spreadsheets
    const PURGE_INTERVAL = 24 * 60 * 60 * 1000;
    await db.purgeStaleSheetRows();
    setInterval(() => db.purgeStaleSheetRows(), PURGE_INTERVAL);
  });
}

// Graceful Shutdown
const shutdown = async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed');
      await prisma.$disconnect();
      process.exit(0);
    });
  } else {
    await prisma.$disconnect();
    process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
