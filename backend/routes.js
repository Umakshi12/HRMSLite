import express from 'express';
import db from './db.js';
import cache from './cache.js';
import { verifyToken, generateToken } from './auth.js';
import { validateRequest, loginSchema, addCandidateSchema } from './validation.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authorization token missing' });
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
};

// ── Auth ──
router.post('/login', validateRequest(loginSchema), asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  const result = await db.login(identifier, password);
  
  if (result.success) {
    const token = generateToken(result.user);
    res.status(200).json({ ...result, token });
  } else {
    res.status(401).json(result);
  }
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { login_id, old_password, new_password } = req.body;
  const result = await db.changePassword(login_id, old_password, new_password);
  res.status(result.success ? 200 : 400).json(result);
}));

// ── Data ──
router.get('/get-sheet-summary', requireAuth, asyncHandler(async (req, res) => {
  res.json(await db.getSheetSummary());
}));

router.get('/get-sheet-data', requireAuth, asyncHandler(async (req, res) => {
  const { sheet, all, page, limit } = req.query;
  const resolvedSheet = all === 'true' ? 'all' : sheet;
  res.json(await db.getSheetData(resolvedSheet, parseInt(page) || 1, parseInt(limit) || 50));
}));

router.post('/apply-filters', requireAuth, asyncHandler(async (req, res) => {
  const { sheet, filters, page, limit } = req.body;
  res.json(await db.applyFilters(sheet, filters || {}, parseInt(page) || 1, parseInt(limit) || 50));
}));

router.post('/add-candidate', requireAuth, validateRequest(addCandidateSchema), asyncHandler(async (req, res) => {
  const { sheet, candidate, added_by } = req.body;
  const result = await db.addCandidate(sheet, candidate, added_by);
  res.status(result.success ? 200 : 400).json(result);
}));

router.put('/edit-candidate', requireAuth, asyncHandler(async (req, res) => {
  const { sr_no, sheet, target_sheet, updated_fields, updated_by } = req.body;
  // Use sheet or target_sheet as the source sheet to search in
  const sourceSheet = sheet || target_sheet;
  if (!sourceSheet) return res.status(400).json({ success: false, message: 'Sheet name is required' });
  const result = await db.editCandidate(sr_no, sourceSheet, target_sheet, updated_fields || {}, updated_by);
  res.status(result.success ? 200 : 400).json(result);
}));

router.delete('/remove-candidate', requireAuth, asyncHandler(async (req, res) => {
  const { sr_no, sheet, removed_by } = req.body;
  const result = await db.removeCandidate(parseInt(sr_no), sheet, removed_by);
  res.status(result.success ? 200 : 400).json(result);
}));

router.get('/check-mobile', requireAuth, asyncHandler(async (req, res) => {
  const { mobile, exclude_sr_no } = req.query;
  res.json(await db.checkMobile(mobile, exclude_sr_no));
}));

// AI Search endpoint
const aiSearchHandler = asyncHandler(async (req, res) => {
  const { query, sheet, search_all_sheets } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const result = await db.applyFilters(search_all_sheets ? 'all' : sheet, { search: query }, 1, 100);
    const data = result.data || [];
    
    for (const row of data) {
      res.write(`data: ${JSON.stringify(row)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('AI Search Error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});
router.post('/ai-search', requireAuth, aiSearchHandler);
router.post('/ai-searchs', requireAuth, aiSearchHandler);

router.get('/get-filter-options', requireAuth, asyncHandler(async (req, res) => {
  const { sheet } = req.query;
  res.json(await db.getFilterOptions(sheet));
}));


// ── Admin ──
router.post('/grant-access', requireAuth, asyncHandler(async (req, res) => {
  const result = await db.grantAccess(req.body);
  res.status(result.success ? 200 : 400).json(result);
}));

router.post('/reset-password', requireAuth, asyncHandler(async (req, res) => {
  const { target_login_id, reset_by } = req.body;
  const result = await db.resetPassword(target_login_id, reset_by);
  res.status(result.success ? 200 : 400).json(result);
}));

router.put('/update-user-rights', requireAuth, asyncHandler(async (req, res) => {
  const result = await db.updateUserRights(req.body);
  res.status(result.success ? 200 : 400).json(result);
}));

router.delete('/remove-user', requireAuth, asyncHandler(async (req, res) => {
  const { target_login_id, removed_by } = req.body;
  const result = await db.removeUser(target_login_id, removed_by);
  res.status(result.success ? 200 : 400).json(result);
}));

router.get('/get-users', requireAuth, asyncHandler(async (req, res) => {
  res.json(await db.getUsers());
}));

router.get('/get-activity-log', requireAuth, asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  res.json(await db.getActivityLog(parseInt(page) || 1, parseInt(limit) || 50));
}));

// ── Cache Management ──
router.post('/clear-cache', requireAuth, asyncHandler(async (req, res) => {
  cache.invalidateSheetData();
  res.json({ success: true, message: 'Cache cleared', stats: cache.stats() });
}));

router.get('/cache-stats', requireAuth, asyncHandler(async (req, res) => {
  res.json(cache.stats());
}));

export default router;
