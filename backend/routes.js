import express from 'express';
import db from './db.js';
import cache from './cache.js';
import { verifyToken, generateToken } from './auth.js';
import { validateRequest, loginSchema, addCandidateSchema } from './validation.js';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Role constants ──
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user',
};

// ── Auth Middleware ──
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Authorization token missing' });
  const decoded = verifyToken(authHeader.split(' ')[1]);
  if (!decoded) return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  req.user = decoded;
  next();
};

// ── Role Middleware (supports both legacy and new role names) ──
const normalizeRole = (role = '') => {
  const r = role.toLowerCase().replace(/\s+/g, '_');
  if (r === 'super_admin' || r === 'super admin') return 'super_admin';
  if (r === 'admin') return 'admin';
  return 'user';
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
  const userRole = normalizeRole(req.user.role);
  if (!roles.map(normalizeRole).includes(userRole))
    return res.status(403).json({ success: false, message: `Access denied. Required: ${roles.join(' or ')}` });
  next();
};

const isAdminOrSuper = requireRole('admin', 'super_admin');
const isSuperAdmin   = requireRole('super_admin');

// ── Sheet Access Middleware ──
const enforceSheetAccess = asyncHandler(async (req, res, next) => {
  const user = req.user;
  const nr = normalizeRole(user?.role);
  
  // Super Admin and Admin have full access
  if (nr === 'super_admin' || nr === 'admin') return next();

  // Determine target sheet name from various sources
  const sheetName = req.query.sheet || req.body.sheet || req.body.target_sheet;
  if (!sheetName) return next(); // Let the route handle missing sheet name if applicable

  // Special case: 'all' or searching across all sheets
  if (sheetName === 'all' || req.body.search_all_sheets) {
    // getCandidateSheets already filters for users, so we can allow it
    // but the actual data fetching will only return granted ones.
    return next();
  }

  // Check if user has explicit grant
  const grantedSheets = await db.getCandidateSheets(user);
  if (grantedSheets.includes(sheetName)) return next();

  res.status(403).json({ 
    success: false, 
    message: `Access denied to sheet: ${sheetName}. Please contact an administrator for access.` 
  });
});

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
  res.json(await db.getSheetSummary(req.user));
}));

router.get('/get-sheet-data', requireAuth, enforceSheetAccess, asyncHandler(async (req, res) => {
  const { sheet, all, page, limit } = req.query;
  const resolvedSheet = all === 'true' ? 'all' : sheet;
  res.json(await db.getSheetData(resolvedSheet, parseInt(page) || 1, parseInt(limit) || 50, req.user));
}));

router.post('/apply-filters', requireAuth, enforceSheetAccess, asyncHandler(async (req, res) => {
  const { sheet, filters, page, limit } = req.body;
  res.json(await db.applyFilters(sheet, filters || {}, parseInt(page) || 1, parseInt(limit) || 50, req.user));
}));

router.post('/add-candidate', requireAuth, enforceSheetAccess, validateRequest(addCandidateSchema), asyncHandler(async (req, res) => {
  const { sheet, candidate, added_by } = req.body;
  const result = await db.addCandidate(sheet, candidate, added_by || req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.put('/edit-candidate', requireAuth, enforceSheetAccess, asyncHandler(async (req, res) => {
  const { sr_no, sheet, target_sheet, updated_fields, updated_by } = req.body;
  const sourceSheet = sheet || target_sheet;
  if (!sourceSheet) return res.status(400).json({ success: false, message: 'Sheet name is required' });
  const result = await db.editCandidate(sr_no, sourceSheet, target_sheet, updated_fields || {}, updated_by || req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.delete('/remove-candidate', requireAuth, enforceSheetAccess, asyncHandler(async (req, res) => {
  const { sr_no, sheet, removed_by } = req.body;
  const result = await db.removeCandidate(parseInt(sr_no), sheet, removed_by || req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.get('/check-mobile', requireAuth, enforceSheetAccess, asyncHandler(async (req, res) => {
  const { mobile, exclude_sr_no } = req.query;
  res.json(await db.checkMobile(mobile, exclude_sr_no, req.user));
}));

// ── AI Search ──
const aiSearchHandler = asyncHandler(async (req, res) => {
  const { query, sheet, search_all_sheets } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let enhancedQuery = query;
    if (process.env.MISTRAL_API_KEY && query?.trim()) {
      try {
        const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}` },
          body: JSON.stringify({
            model: 'mistral-small-latest',
            messages: [{ role: 'user', content: `Extract search keywords from this HR candidate search query. Return ONLY a space-separated list of keywords, nothing else. Query: "${query}"` }],
            max_tokens: 100, temperature: 0.1,
          }),
        });
        if (mistralRes.ok) {
          const data = await mistralRes.json();
          const extracted = data?.choices?.[0]?.message?.content?.trim();
          if (extracted) enhancedQuery = extracted;
        }
      } catch (err) { console.warn('[Mistral] Falling back to direct search:', err.message); }
    }

    const targetSheet = search_all_sheets ? 'all' : sheet;
    const result = await db.applyFilters(targetSheet, { search: enhancedQuery }, 1, 200, req.user);
    for (const row of (result.data || [])) res.write(`data: ${JSON.stringify(row)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: 'Search failed' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});
router.post('/ai-search', requireAuth, enforceSheetAccess, aiSearchHandler);
router.post('/ai-searchs', requireAuth, enforceSheetAccess, aiSearchHandler);

router.get('/get-filter-options', requireAuth, enforceSheetAccess, asyncHandler(async (req, res) => {
  const { sheet } = req.query;
  res.json(await db.getFilterOptions(sheet, req.user));
}));

// ── Bulk CSV Import ──
router.post('/bulk-import', requireAuth, isAdminOrSuper, upload.single('file'), asyncHandler(async (req, res) => {
  const { sheet } = req.body;
  if (!sheet) return res.status(400).json({ success: false, message: 'Target sheet required' });
  if (!req.file) return res.status(400).json({ success: false, message: 'CSV file required' });
  let records;
  try {
    records = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ success: false, message: 'Invalid CSV: ' + e.message });
  }
  const result = await db.bulkImport(sheet, records, req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

// ── Spreadsheet Registry ──
router.get('/spreadsheets', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  res.json(await db.getRegisteredSpreadsheets());
}));

router.post('/spreadsheets', requireAuth, isSuperAdmin, asyncHandler(async (req, res) => {
  const { spreadsheet_id, name } = req.body;
  if (!spreadsheet_id) return res.status(400).json({ success: false, message: 'spreadsheet_id required' });
  const result = await db.addSpreadsheet(spreadsheet_id, req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.delete('/spreadsheets/:id', requireAuth, isSuperAdmin, asyncHandler(async (req, res) => {
  const result = await db.removeSpreadsheet(req.params.id, req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.post('/spreadsheets/:id/sync', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const result = await db.syncSpreadsheet(req.params.id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.get('/spreadsheets/:id/data', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  try {
    const data = await db.getSheetDataForSpreadsheet(req.params.id);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
}));

router.get('/spreadsheets/:id/grants', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const result = await db.getGrantsForSheet(req.params.id);
  res.json(result);
}));

router.post('/spreadsheets/:id/grants', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ success: false, message: 'user_ids must be an array' });
  const result = await db.updateGrantsForSheet(req.params.id, user_ids, req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.post('/spreadsheets/sync-all', requireAuth, isSuperAdmin, asyncHandler(async (req, res) => {
  await db.syncAllActiveSpreadsheets();
  res.json({ success: true, message: 'Scheduled sync complete' });
}));

// ── Advanced CSV Import Wizard ──

// Step 1: Preview (Get headers and first 5 rows)
router.post('/import/preview', requireAuth, isAdminOrSuper, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'CSV file required' });
  
  try {
    const csvContent = req.file.buffer.toString('utf8');
    const records = parse(csvContent, { 
      columns: true, 
      skip_empty_lines: true, 
      trim: true,
      to: 6 // Headers + 5 rows
    });
    
    const headers = Object.keys(records[0] || {});
    res.json({ success: true, headers, preview: records });
  } catch (e) {
    res.status(400).json({ success: false, message: 'Invalid CSV: ' + e.message });
  }
}));

// Step 3: Validate (Check formats and duplicates)
router.post('/import/validate', requireAuth, isAdminOrSuper, upload.single('file'), asyncHandler(async (req, res) => {
  const { mapping, sheet } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'CSV file required' });
  if (!mapping) return res.status(400).json({ success: false, message: 'Mapping JSON required' });
  
  const columnMapping = JSON.parse(mapping);
  const csvContent = req.file.buffer.toString('utf8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  
  const result = await db.validateCSVImport(records, columnMapping, sheet, req.user);
  res.json(result);
}));

// Step 4: Final Import
router.post('/import/csv', requireAuth, isAdminOrSuper, upload.single('file'), asyncHandler(async (req, res) => {
  const { mapping, sheet } = req.body;
  if (!req.file) return res.status(400).json({ success: false, message: 'CSV file required' });
  if (!mapping) return res.status(400).json({ success: false, message: 'Mapping JSON required' });
  
  const columnMapping = JSON.parse(mapping);
  const csvContent = req.file.buffer.toString('utf8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  
  const result = await db.processCSVImport(records, columnMapping, sheet, req.user);
  res.json(result);
}));

// ── User Management ──

// GET /get-users — returns users scoped to caller's role
// super_admin: all users | admin: only their own created users | user: 403
router.get('/get-users', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const callerRole = normalizeRole(req.user.role);
  const result = await db.getUsers(callerRole === 'super_admin' ? null : req.user.login_id);
  res.json(result);
}));

// GET /get-admin-dashboard — super_admin only: all admins + quota usage
router.get('/get-admin-dashboard', requireAuth, isSuperAdmin, asyncHandler(async (req, res) => {
  res.json(await db.getAdminDashboard());
}));

// POST /grant-access — admin creates user, super_admin creates admin or user
router.post('/grant-access', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const callerRole = normalizeRole(req.user.role);
  const targetRole = normalizeRole(req.body.role || 'user');

  // Only super_admin can create admins
  if (targetRole === 'admin' && callerRole !== 'super_admin')
    return res.status(403).json({ success: false, message: 'Only Super Admin can create Admin accounts' });

  // Admins cannot exceed their quota
  if (callerRole === 'admin') {
    const quotaCheck = await db.checkAdminQuota(req.user.login_id);
    if (!quotaCheck.canCreate)
      return res.status(403).json({ success: false, message: `Quota reached (${quotaCheck.used}/${quotaCheck.max}). Contact Super Admin.` });
  }

  const result = await db.grantAccess({
    ...req.body,
    role: targetRole,
    created_by: req.user.login_id,
  });
  res.status(result.success ? 200 : 400).json(result);
}));

router.post('/reset-password', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const { target_login_id } = req.body;
  // Admins can only reset passwords of their own users
  const callerRole = normalizeRole(req.user.role);
  if (callerRole === 'admin') {
    const ownership = await db.checkUserOwnership(req.user.login_id, target_login_id);
    if (!ownership) return res.status(403).json({ success: false, message: 'You can only reset passwords of your own users' });
  }
  const result = await db.resetPassword(target_login_id, req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.put('/update-user-rights', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const callerRole = normalizeRole(req.user.role);
  const targetRole = normalizeRole(req.body.role || 'user');

  // Only super_admin can promote to admin
  if (targetRole === 'admin' && callerRole !== 'super_admin')
    return res.status(403).json({ success: false, message: 'Only Super Admin can promote users to Admin' });

  // Admins can only edit their own users
  if (callerRole === 'admin') {
    const ownership = await db.checkUserOwnership(req.user.login_id, req.body.target_login_id);
    if (!ownership) return res.status(403).json({ success: false, message: 'You can only manage your own users' });
  }

  const result = await db.updateUserRights({ ...req.body, role: targetRole, updated_by: req.user?.login_id });
  res.status(result.success ? 200 : 400).json(result);
}));

router.delete('/remove-user', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const callerRole = normalizeRole(req.user.role);
  const { target_login_id } = req.body;

  // Admins can only remove their own users
  if (callerRole === 'admin') {
    const ownership = await db.checkUserOwnership(req.user.login_id, target_login_id);
    if (!ownership) return res.status(403).json({ success: false, message: 'You can only remove your own users' });
    // Prevent removing admin accounts
    const targetUser = await db.getUserById(target_login_id);
    if (normalizeRole(targetUser?.role) !== 'user')
      return res.status(403).json({ success: false, message: 'Admins cannot remove other admins' });
  }

  const result = await db.removeUser(target_login_id, req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

// Update admin's max_user_quota — super_admin only
router.put('/update-user-limit', requireAuth, isSuperAdmin, asyncHandler(async (req, res) => {
  const { target_login_id, max_users } = req.body;
  if (!target_login_id || max_users === undefined)
    return res.status(400).json({ success: false, message: 'target_login_id and max_users required' });
  const result = await db.updateUserLimit(target_login_id, max_users, req.user?.login_id);
  res.status(result.success ? 200 : 400).json(result);
}));

router.get('/get-activity-log', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  res.json(await db.getActivityLog(parseInt(page) || 1, parseInt(limit) || 50));
}));

// ── Cache ──
router.post('/clear-cache', requireAuth, isAdminOrSuper, asyncHandler(async (req, res) => {
  cache.invalidateSheetData();
  res.json({ success: true, message: 'Cache cleared', stats: cache.stats() });
}));

router.get('/cache-stats', requireAuth, asyncHandler(async (req, res) => {
  res.json(cache.stats());
}));

export default router;
