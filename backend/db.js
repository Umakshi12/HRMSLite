import * as sheetsAPI from './googleSheetsService.js';
import { v4 as uuidv4 } from 'uuid';
import { sendWelcomeEmail } from './emailService.js';
import { hashPassword, comparePassword } from './auth.js';
import cache from './cache.js';
import prisma from './prisma/client.js';
import { ChatMistralAI } from '@langchain/mistralai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z as zod } from 'zod';

const FALLBACK_SHEETS = [];
const EXCLUDED_SHEETS = new Set(['users', 'activitylog', 'activity_logs', 'activity logs', 'config', 'spreadsheetregistry', 'spreadsheet_registry', 'google_sheets', 'sheet_access_grants']);
const activeSyncs = new Map();

class ProductionDatabase {
  resolveHeaderIndex(headers, aliases) {
    const normalizedHeaders = headers.map((h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
    const normalizedAliases = aliases.map((a) => String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
    return normalizedHeaders.findIndex((h) => normalizedAliases.includes(h));
  }

  setIfHeaderExists(row, headers, aliases, value) {
    const idx = this.resolveHeaderIndex(headers, aliases);
    if (idx >= 0) row[idx] = value;
  }

  getIfHeaderExists(row, headers, aliases) {
    const idx = this.resolveHeaderIndex(headers, aliases);
    return idx >= 0 ? row[idx] : '';
  }

  // Normalize role string to canonical form
  normalizeRole(role = '') {
    const r = String(role).toLowerCase().replace(/\s+/g, '_');
    if (r === 'super_admin') return 'super_admin';
    if (r === 'admin') return 'admin';
    return 'user';
  }

  // Human-readable display role
  displayRole(role = '') {
    const n = this.normalizeRole(role);
    if (n === 'super_admin') return 'Super Admin';
    if (n === 'admin') return 'Admin';
    return 'User';
  }

  isAdminOrSuper(role) { const r = this.normalizeRole(role); return r === 'admin' || r === 'super_admin'; }
  isSuperAdmin(role) { return this.normalizeRole(role) === 'super_admin'; }

  async getCandidateSheets(user) {
    const nr = this.normalizeRole(user?.role);
    const cacheKey = nr === 'super_admin' ? 'sheet-names-super-admin' : `sheet-names-${user?.login_id || 'anon'}`;
    return cache.getOrFetch(cacheKey, async () => {
      try {
        const allSheets = await this._getAllSheetsFromRegistry();
        const candidateSheets = allSheets.filter((s) => !EXCLUDED_SHEETS.has(String(s.name).toLowerCase()));

        if (nr === 'super_admin') return candidateSheets.map(s => s.name);

        // Admin and users only see explicitly granted sheets
        const grants = await prisma.userTabAccess.findMany({ where: { user_id: user.login_id } });
        const grantedSpreadsheetIds = new Set(grants.map(g => g.spreadsheet_id));
        return candidateSheets.filter(s => grantedSpreadsheetIds.has(s.id)).map(s => s.name);
      } catch (err) {
        console.warn(`Falling back to static sheet list: ${err.message}`);
        return FALLBACK_SHEETS;
      }
    }, 5 * 60 * 1000);
  }

  async _getAllSheetsFromRegistry() {
    try {
      const spreadsheets = await this.getRegisteredSpreadsheets();
      
      // If we have manually registered spreadsheets, use them
      if (spreadsheets && spreadsheets.length > 0) {
        return spreadsheets.filter(s => s.is_active);
      }

      // AUTO-DISCOVERY FALLBACK:
      // If registry is empty, fetch all tabs from the primary spreadsheet
      const metadata = await sheetsAPI.getSpreadsheetMetadata();
      if (metadata && metadata.sheets) {
        const discovered = metadata.sheets
          .map(s => ({
            id: s.properties.sheetId,
            name: s.properties.title,
            is_active: true
          }))
          .filter(s => !EXCLUDED_SHEETS.has(s.name.toLowerCase()));
        
        return discovered;
      }
      
      return [];
    } catch (e) {
      console.warn('Auto-discovery failed, using fallback list:', e.message);
      return FALLBACK_SHEETS.map(name => ({ id: name, name, is_active: true }));
    }
  }

  async resolveTargetSheets(sheet, user) {
    const nr = this.normalizeRole(user?.role);

    // only super_admin bypasses sheet grants — admin and users need explicit grants
    if (nr === 'super_admin') {
      if (sheet && sheet !== 'all') return [sheet];
      return this.getCandidateSheets(user);
    }

    // Admin and User: restrict to explicitly granted sheets
    const grantedSheets = await this.getCandidateSheets(user);
    if (sheet && sheet !== 'all') {
      return grantedSheets.includes(sheet) ? [sheet] : [];
    }
    return grantedSheets;
  }

  // normalizeCandidate REMOVED — all sheet data is now returned as-is from rowsToObjects()

  /**
   * Resolve an array of access names (which may be spreadsheet display names OR actual tab names)
   * into a flat array of SpreadsheetTab records. Granting "Restro Database" expands to all its tabs.
   */
  async _resolveSheetAccessToTabs(sheetAccess) {
    if (!sheetAccess || sheetAccess.length === 0) return [];

    // Step 1: try direct tab-name match
    const byTabName = await prisma.spreadsheetTab.findMany({
      where: { tab_name: { in: sheetAccess }, deleted_at: null },
    });
    const foundTabNames = new Set(byTabName.map(t => t.tab_name));

    // Step 2: anything not found as a tab name — try as spreadsheet display name
    const unfound = sheetAccess.filter(s => !foundTabNames.has(s));
    let bySpreadsheetName = [];
    if (unfound.length > 0) {
      const spreadsheets = await prisma.spreadsheet.findMany({
        where: { name: { in: unfound } },
        include: { tabs: { where: { deleted_at: null } } },
      });
      bySpreadsheetName = spreadsheets.flatMap(ss => ss.tabs);
    }

    return [...byTabName, ...bySpreadsheetName];
  }

  async getSpreadsheetIdForTab(sheetName) {
    const spreadsheets = await this.getRegisteredSpreadsheets();
    const reg = spreadsheets.find(ss => ss.name === sheetName || ss.tab_name === sheetName);
    return reg ? reg.sheet_id : undefined;
  }

  // ── Postgres cache helpers (shared by sync + write-through) ──

  // Ensures "Updated By" and "Updated At" columns exist in the Google Sheet's header row.
  // If either is missing, appends them to row 1 and returns the updated headers array.
  // Safe to call on every sync — no-ops if the columns already exist.
  async _ensureAuditColumns(tabName, headers, sheet_id) {
    const AUDIT_COLS = ['Updated By', 'Updated At'];
    const missing = AUDIT_COLS.filter(col =>
      !headers.some(h => String(h || '').trim().toLowerCase() === col.toLowerCase())
    );
    if (missing.length === 0) return headers;

    const newHeaders = [...headers, ...missing];
    try {
      await sheetsAPI.updateRow(tabName, 0, newHeaders, sheet_id);
      console.log(`[AuditCols] Added [${missing.join(', ')}] to "${tabName}" header row`);
    } catch (err) {
      console.warn(`[AuditCols] Could not update headers for "${tabName}": ${err.message}`);
      return headers; // don't fail sync if header update fails
    }
    return newHeaders;
  }

  _normalizeHeaderKey(h, i) {
    return String(h || `col_${i + 1}`).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `col_${i + 1}`;
  }

  /** Build a SheetRow.data object from a raw sheet row array, matching sync normalization exactly */
  _buildRowData(headers, rowArray, dataIndex) {
    const rowObj = {};
    headers.forEach((h, i) => {
      rowObj[this._normalizeHeaderKey(h, i)] = rowArray[i] !== undefined && rowArray[i] !== null ? rowArray[i] : '';
    });
    if (!rowObj.sr_no) rowObj.sr_no = dataIndex + 1;
    return rowObj;
  }

  /** Resolve app-level sheet names to registered spreadsheets (Postgres-cached) */
  async _resolveRegisteredSpreadsheets(sheetNames) {
    const regs = await this.getRegisteredSpreadsheets();
    const matched = [];
    const unmatched = [];
    for (const name of sheetNames) {
      const reg = regs.find(ss => ss.name === name || ss.tab_name === name);
      if (reg) matched.push({ id: reg.id, sheet_id: reg.sheet_id, name });
      else unmatched.push(name);
    }
    return { matched, unmatched };
  }

  /** Sync any registered spreadsheet whose Postgres cache is empty (first access) */
  async _ensureSynced(matched) {
    await Promise.all(matched.map(async (m) => {
      const count = await prisma.sheetRow.count({ where: { spreadsheet_id: m.id } });
      if (count === 0) await this.syncSpreadsheet(m.sheet_id);
    }));
  }

  /**
   * Write-through: after a successful write to Google Sheets, mirror the change
   * into the Postgres cache so users see it instantly. Falls back to a
   * background full re-sync if the row can't be targeted precisely.
   */
  async _writeThroughUpsert(googleSheetId, tabName, headers, rowArray, rowIndex, actor) {
    try {
      if (!googleSheetId) return; // unregistered/primary sheet — legacy path serves it
      const ss = await prisma.spreadsheet.findUnique({ where: { sheet_id: googleSheetId } });
      if (!ss) return;
      const tab = await prisma.spreadsheetTab.findFirst({
        where: { spreadsheet_id: ss.id, tab_name: tabName },
      });
      if (!tab) {
        this.syncSpreadsheet(googleSheetId).catch(() => {});
        return;
      }
      const data = this._buildRowData(headers, rowArray, rowIndex - 1);
      await prisma.sheetRow.upsert({
        where: { spreadsheet_id_tab_name_row_index: { spreadsheet_id: ss.id, tab_name: tabName, row_index: rowIndex } },
        update: { data, search_vector: Object.values(data).join(' ').toLowerCase(), modified_by: actor || null },
        create: {
          spreadsheet_id: ss.id, tab_name: tabName, row_index: rowIndex,
          data, search_vector: Object.values(data).join(' ').toLowerCase(),
          created_by: actor || null,
        },
      });
    } catch (e) {
      console.warn('[WriteThrough] Upsert failed, scheduling background sync:', e.message);
      if (googleSheetId) this.syncSpreadsheet(googleSheetId).catch(() => {});
    }
  }

  async _writeThroughDelete(googleSheetId, tabName, rowIndex) {
    try {
      if (!googleSheetId) return;
      const ss = await prisma.spreadsheet.findUnique({ where: { sheet_id: googleSheetId } });
      if (!ss) return;
      await prisma.$transaction([
        prisma.sheetRow.deleteMany({ where: { spreadsheet_id: ss.id, tab_name: tabName, row_index: rowIndex } }),
        // Subsequent rows shift up by one in the Google Sheet — mirror that
        prisma.sheetRow.updateMany({
          where: { spreadsheet_id: ss.id, tab_name: tabName, row_index: { gt: rowIndex } },
          data: { row_index: { decrement: 1 } },
        }),
      ]);
    } catch (e) {
      console.warn('[WriteThrough] Delete failed, scheduling background sync:', e.message);
      if (googleSheetId) this.syncSpreadsheet(googleSheetId).catch(() => {});
    }
  }

  /** Cached sheet data fetch — returns raw dynamic objects keyed by actual header names */
  async getCachedSheetData(sheetName) {
    const cacheKey = `sheet:${sheetName}`;
    return cache.getOrFetch(cacheKey, async () => {
      // Check Neon SheetRow cache first
      const spreadsheets = await this.getRegisteredSpreadsheets();
      const reg = spreadsheets.find(ss => ss.name === sheetName || ss.tab_name === sheetName);

      let flatRows;
      if (reg) {
        const result = await this.getSheetDataForSpreadsheet(reg.id);
        // Combine all tabs into one flat array; each row already has _tab_name from the data object
        flatRows = (result.tabs || []).flatMap(t =>
          t.data.map(row => ({ ...row, _tab_name: t.name }))
        );
        if (flatRows.length === 0 && result.data?.length) {
          // Legacy fallback — single-tab result
          flatRows = result.data;
        }
      } else {
        const rows = await sheetsAPI.getSheetDataFull(sheetName);
        flatRows = sheetsAPI.rowsToObjects(rows);
      }

      // Return raw dynamic objects — no normalizeCandidate, preserve all columns
      return flatRows.map(row => ({ ...row, _sheet: sheetName }));
    }, 2 * 60 * 1000);
  }

  /** Load all candidate data across sheets with caching */
  async getAllCandidateData(sheet, user) {
    const sheetNames = await this.resolveTargetSheets(sheet, user);
    const results = await Promise.allSettled(
      sheetNames.map((s) => this.getCachedSheetData(s))
    );
    let allData = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allData = allData.concat(r.value);
      else console.warn(`Sheet fetch failed: ${r.reason?.message}`);
    }
    return allData;
  }

  // ── Auth & Users ──
  async login(identifier, password) {
    try {
      console.log(`[Login] Attempt for: ${identifier}`);
      
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { identifier: identifier },
            { login_id: identifier }
          ]
        },
        include: {
          tabAccess: { include: { spreadsheet: { select: { name: true } } } }
        }
      });

      if (!user) {
        console.warn(`[Login] No user found matching identifier: ${identifier}`);
        return { success: false, message: 'Invalid credentials' };
      }

      if (user.status !== 'active') {
        console.warn(`[Login] User account is ${user.status}: ${identifier}`);
        return { success: false, message: 'Account is inactive' };
      }

      const isMatch = await comparePassword(password, user.password);
      if (!isMatch) {
        console.warn(`[Login] Password mismatch for: ${identifier}`);
        return { success: false, message: 'Invalid credentials' };
      }

      console.log(`[Login] Success for user: ${user.login_id} (${user.role})`);
      
      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { last_login: new Date() }
      });
      
      // SECURITY: Audit log successful login
      await this.logActivity({
        action: 'USER_LOGIN',
        actor: user.login_id,
        details: `Login via ${identifier}`
      });

      return {
        success: true,
        user: {
          id: user.id,
          login_id: user.login_id,
          identifier: user.identifier,
          role: this.normalizeRole(user.role),
          name: user.name,
          status: user.status,
          tenant_id: user.tenant_id,
          sheet_access: [...new Set(user.tabAccess.map(a => a.spreadsheet?.name || a.tab_name))]
        }
      };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, message: 'Server error during login' };
    }
  }

  safeParseAccess(access) {
    if (!access) return [];
    if (access.toLowerCase() === 'all') return ['All'];
    try { return JSON.parse(access); } catch { return access.split(',').map(s => s.trim()); }
  }

  /** Derive a clean login_id from name: "Ruchi Joshi" → "ruchi.joshi", with collision suffix */
  async _generateLoginId(name) {
    const base = String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '.');
    const slug = base || 'user';
    // Try base, then base2, base3 …
    let candidate = slug;
    let suffix = 2;
    while (await prisma.user.findUnique({ where: { login_id: candidate } })) {
      candidate = `${slug}${suffix++}`;
    }
    return candidate;
  }

  // ── Google Sheet user sync helpers ──
  static AUTH_SHEET      = 'HRMS_auth_data';
  static USERS_TAB       = 'Users';
  static ACTIVITY_TAB    = 'ActivityLog';
  static USER_HEADERS    = ['Login ID', 'Identifier', 'Password', 'Role', 'Status', 'Name', 'Phone', 'Created By', 'Created At', 'Last Login', 'Sheet Access'];
  static ACTIVITY_HEADERS = ['Action', 'Actor', 'Details', 'Timestamp'];

  /** Upsert one user row in the HRMS_auth_data > Users tab */
  async _syncUserToSheet(user) {
    try {
      const spreadsheetId = process.env.SPREADSHEET_ID;
      await sheetsAPI.ensureSheetExists(db.USERS_TAB, db.USER_HEADERS, spreadsheetId);
      const rows = await sheetsAPI.getSheetDataFull(db.USERS_TAB, spreadsheetId);
      const headers = rows[0] || db.USER_HEADERS;
      const loginIdCol = headers.findIndex(h => /login.?id/i.test(h));

      const existingIdx = rows.findIndex((r, i) => i > 0 && r[loginIdCol] === user.login_id);
      const sheetAccess = Array.isArray(user.sheet_access) ? JSON.stringify(user.sheet_access) : (user.sheet_access || '[]');

      const rowMap = {
        'Login ID':    user.login_id,
        'Identifier':  user.identifier || '',
        'Password':    user.password_hash || '',
        'Role':        user.role || 'user',
        'Status':      user.status || 'active',
        'Name':        user.name || '',
        'Phone':       user.phone || '',
        'Created By':  user.created_by || '',
        'Created At':  user.created_at ? new Date(user.created_at).toISOString() : new Date().toISOString(),
        'Last Login':  user.last_login ? new Date(user.last_login).toISOString() : '',
        'Sheet Access': sheetAccess,
      };
      const row = headers.map(h => rowMap[h] ?? '');

      if (existingIdx === -1) {
        await sheetsAPI.appendRow(`${db.USERS_TAB}!A:A`, row, spreadsheetId);
      } else {
        await sheetsAPI.updateRow(db.USERS_TAB, existingIdx, row, spreadsheetId);
      }
    } catch (err) {
      console.warn('[SheetSync] Failed to sync user to sheet:', err.message);
    }
  }

  /** Append one row to the HRMS_auth_data > ActivityLog tab */
  async _appendActivityToSheet(action, actor, details) {
    try {
      const spreadsheetId = process.env.SPREADSHEET_ID;
      await sheetsAPI.ensureSheetExists(db.ACTIVITY_TAB, db.ACTIVITY_HEADERS, spreadsheetId);
      await sheetsAPI.appendRow(`${db.ACTIVITY_TAB}!A:D`, [action, actor || 'system', details || '', new Date().toISOString()], spreadsheetId);
    } catch (err) {
      console.warn('[SheetSync] Failed to append activity log:', err.message);
    }
  }

  async grantAccess(data) {
    if (!data.name || !data.name.trim()) {
      return { success: false, message: 'Name is required to create a user.' };
    }
    const newLoginId = await this._generateLoginId(data.name);
    // Generate a readable temp password: word + 4-digit number
    const words = ['Spring', 'Lotus', 'River', 'Cloud', 'Stone'];
    const tempPassword = words[Math.floor(Math.random() * words.length)] + Math.floor(1000 + Math.random() * 9000);
    try {
      const hashedPassword = await hashPassword(tempPassword);
      const normalizedRole = this.normalizeRole(data.role || 'user');
      
      const newUser = await prisma.user.create({
        data: {
          login_id: newLoginId,
          identifier: data.identifier,
          phone: data.phone || null,
          password: hashedPassword,
          role: normalizedRole,
          status: 'active',
          notes: data.notes || '',
          max_user_quota: normalizedRole === 'admin' ? (parseInt(data.max_users) || 10) : 10,
          created_by: data.created_by || data.added_by || 'Admin'
        }
      });

      // Grant tab access — resolves both tab names AND spreadsheet display names
      if (data.sheet_access && Array.isArray(data.sheet_access) && data.sheet_access.length > 0) {
        const tabRecords = await this._resolveSheetAccessToTabs(data.sheet_access);
        await Promise.all(tabRecords.map(t =>
          prisma.userTabAccess.upsert({
            where: { user_id_spreadsheet_id_tab_name: { user_id: newLoginId, spreadsheet_id: t.spreadsheet_id, tab_name: t.tab_name } },
            create: { user_id: newLoginId, spreadsheet_id: t.spreadsheet_id, tab_name: t.tab_name, granted_by: data.created_by || 'Admin' },
            update: {},
          })
        ));
      }

      // Fire email async — do NOT await so the API responds immediately
      const isEmail = data.identifier && data.identifier.includes('@');
      const hasPhone = !isEmail || data.phone;

      const emailSent = isEmail;
      if (isEmail) {
        sendWelcomeEmail(data.identifier, newLoginId, tempPassword, data.name || '')
          .catch(e => console.error('[Email] Welcome email failed silently:', e.message));
      }

      if (hasPhone && process.env.TWILIO_ACCOUNT_SID) {
        const phone = data.phone || (!isEmail ? data.identifier : null);
        if (phone) {
          try {
            const twilio = (await import('twilio')).default;
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await client.messages.create({
              body: `HRMS Access Granted\nLogin ID: ${newLoginId}\nPassword: ${tempPassword}\nLogin: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: phone.startsWith('+') ? phone : `+91${phone}`
            });
          } catch (smsErr) {
            console.warn('SMS failed (non-fatal):', smsErr.message);
          }
        }
      }

      cache.invalidate(/^sheet-names-/);
      await this.logActivity({ action: 'GRANT_ACCESS', actor: data.created_by || 'Admin', details: `Created ${normalizedRole} account for ${data.identifier}` });

      // Sync new user to HRMS_auth_data Google Sheet (fire-and-forget)
      this._syncUserToSheet({
        login_id: newLoginId,
        identifier: data.identifier,
        password_hash: hashedPassword,
        role: normalizedRole,
        status: 'active',
        name: data.name || '',
        phone: data.phone || '',
        created_by: data.created_by || 'Admin',
        sheet_access: data.sheet_access || [],
      }).catch(() => {});
      this._appendActivityToSheet('GRANT_ACCESS', data.created_by || 'Admin', `Created ${normalizedRole} account for ${data.identifier}`).catch(() => {});

      return {
        success: true,
        login_id: newLoginId,
        password: tempPassword,
        message: emailSent ? 'Access granted and welcome email sent.' : 'Access granted. Welcome message sent.'
      };
    } catch (err) {
      console.error('Grant Access Error:', err);
      // SECURITY: Generic error message to prevent leaking system details
      return { success: false, message: 'Could not grant access. Please check inputs or contact Super Admin.' };
    }
  }

  // getUsers: if created_by is provided, filter to only that admin's users (admin scope)
  async getUsers(viewer_login_id, viewer_role = 'user') {
    try {
      const isSuper = this.normalizeRole(viewer_role) === 'super_admin';
      
      const users = await prisma.user.findMany({
        where: {
          // Super Admins see everyone. Admins see themselves + users they created.
          ...(isSuper ? {} : {
            OR: [
              { created_by: viewer_login_id },
              { login_id: viewer_login_id }
            ]
          })
        },
        include: {
          tabAccess: { include: { spreadsheet: { select: { name: true } } } }
        },
        orderBy: { created_at: 'desc' }
      });

      return {
        users: users.map(u => ({
          login_id: u.login_id,
          name: u.name,
          identifier: u.identifier,
          phone: u.phone,
          role: u.role,
          display_role: this.displayRole(u.role),
          status: u.status,
          sheet_access: [...new Set(u.tabAccess.map(a => a.spreadsheet?.name || a.tab_name))],
          max_user_quota: u.max_user_quota,
          created_by: u.created_by,
          created_at: u.created_at,
        }))
      };
    } catch (err) {
      console.error('getUsers error:', err);
      return { users: [] };
    }
  }

  // Check if a user belongs to an admin (for scoped operations)
  async checkUserOwnership(admin_login_id, target_login_id) {
    const user = await prisma.user.findUnique({
      where: { login_id: target_login_id },
      select: { created_by: true }
    });
    return user?.created_by === admin_login_id;
  }

  async getUserById(login_id) {
    const user = await prisma.user.findUnique({
      where: { login_id },
      include: { tabAccess: true }
    });
    if (!user) return null;
    return {
      login_id: user.login_id,
      role: user.role,
      identifier: user.identifier,
      name: user.name || '',
      phone: user.phone || '',
      sheet_access: user.tabAccess.map(a => a.tab_name)
    };
  }

  async checkAdminQuota(admin_login_id) {
    const admin = await prisma.user.findUnique({
      where: { login_id: admin_login_id },
      select: { max_user_quota: true }
    });
    const used = await prisma.user.count({
      where: { created_by: admin_login_id, status: 'active' }
    });
    const max = admin?.max_user_quota || 10;
    return { canCreate: used < max, used, max };
  }

  async updateUserProfile(reqData) {
    const { target_login_id, updated_by, sheet_access } = reqData;
    try {
      const allowedFields = ['identifier', 'phone', 'name'];
      const updateData = {};
      
      // SECURITY: Mass assignment protection - only allow specific fields
      allowedFields.forEach(field => {
        if (reqData[field] !== undefined) updateData[field] = reqData[field];
      });

      await prisma.user.update({
        where: { login_id: target_login_id },
        data: updateData
      });

      // Replace sheet access grants — resolves both tab names AND spreadsheet display names
      if (Array.isArray(sheet_access)) {
        await prisma.userTabAccess.deleteMany({ where: { user_id: target_login_id } });
        if (sheet_access.length > 0) {
          const tabRecords = await this._resolveSheetAccessToTabs(sheet_access);
          await Promise.all(tabRecords.map(t =>
            prisma.userTabAccess.create({
              data: { user_id: target_login_id, spreadsheet_id: t.spreadsheet_id, tab_name: t.tab_name, granted_by: updated_by || 'super_admin' },
            })
          ));
        }
      }

      // Bust the target user's sheet-summary and sheet-names caches so they see updated access
      cache.invalidate(new RegExp(`^sheet-summary-${target_login_id}$`));
      cache.invalidate(/^sheet-names-/);

      await this.logActivity({
        action: 'UPDATE_PROFILE',
        actor: updated_by,
        details: `Updated profile for ${target_login_id}`
      });

      // Sync updated user to Google Sheet
      const updatedUser = await prisma.user.findUnique({ where: { login_id: target_login_id }, include: { tabAccess: true } });
      if (updatedUser) {
        this._syncUserToSheet({ ...updatedUser, password_hash: updatedUser.password, sheet_access: updatedUser.tabAccess.map(a => a.tab_name) }).catch(() => {});
      }
      this._appendActivityToSheet('UPDATE_PROFILE', updated_by, `Updated profile for ${target_login_id}`).catch(() => {});

      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async updateUserRights(reqData) {
    const { target_login_id, role, sheet_access, updated_by } = reqData;
    try {
      const updateData = {};
      if (role !== undefined) {
        updateData.role = role;
      }
      
      // Also allow other profile fields if passed
      const allowedFields = ['identifier', 'phone', 'name'];
      allowedFields.forEach(field => {
        if (reqData[field] !== undefined) updateData[field] = reqData[field];
      });

      await prisma.user.update({
        where: { login_id: target_login_id },
        data: updateData
      });

      // Replace sheet access grants — resolves both tab names AND spreadsheet display names
      if (Array.isArray(sheet_access)) {
        await prisma.userTabAccess.deleteMany({ where: { user_id: target_login_id } });
        if (sheet_access.length > 0) {
          const tabRecords = await this._resolveSheetAccessToTabs(sheet_access);
          await Promise.all(tabRecords.map(t =>
            prisma.userTabAccess.create({
              data: { user_id: target_login_id, spreadsheet_id: t.spreadsheet_id, tab_name: t.tab_name, granted_by: updated_by || 'super_admin' },
            })
          ));
        }
      }

      cache.invalidate(/^sheet-names-/);
      await this.logActivity({
        action: 'UPDATE_RIGHTS',
        actor: updated_by,
        details: `Updated rights/profile for ${target_login_id}`
      });

      // Sync updated user to Google Sheet
      const updatedUser = await prisma.user.findUnique({ where: { login_id: target_login_id }, include: { tabAccess: true } });
      if (updatedUser) {
        this._syncUserToSheet({ ...updatedUser, password_hash: updatedUser.password, sheet_access: updatedUser.tabAccess.map(a => a.tab_name) }).catch(() => {});
      }
      this._appendActivityToSheet('UPDATE_RIGHTS', updated_by, `Updated rights/profile for ${target_login_id}`).catch(() => {});

      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async removeUser(target_login_id, removed_by) {
    try {
      // 1. Delete user tab accesses first to avoid foreign key violations
      await prisma.userTabAccess.deleteMany({
        where: { user_id: target_login_id }
      });
      // 2. Delete google OAuth tokens if present
      await prisma.googleOAuthToken.deleteMany({
        where: { owner_login_id: target_login_id }
      });
      // 3. Delete user
      await prisma.user.delete({
        where: { login_id: target_login_id }
      });

      await this.logActivity({
        action: 'REMOVE_USER',
        actor: removed_by,
        details: `Removed user ${target_login_id}`
      });

      // Mark user as removed in Google Sheet (status = 'removed')
      this._syncUserToSheet({ login_id: target_login_id, status: 'removed', role: '', identifier: '', name: '', phone: '', created_by: '', sheet_access: [] }).catch(() => {});
      this._appendActivityToSheet('REMOVE_USER', removed_by, `Removed user ${target_login_id}`).catch(() => {});

      return { success: true };
    } catch (err) {
      console.error('removeUser error:', err);
      return { success: false, message: err.message };
    }
  }

  async getAdminDashboard() {
    try {
      const admins = await prisma.user.findMany({
        where: { 
          role: 'admin',
          status: 'active' 
        }
      });
      
      const adminStats = await Promise.all(admins.map(async (a) => {
        const used = await prisma.user.count({
          where: { created_by: a.login_id, status: 'active' }
        });
        return {
          login_id: a.login_id,
          identifier: a.identifier,
          display_role: 'Admin',
          max_user_quota: a.max_user_quota,
          used_quota: used,
          quota_pct: Math.round((used / (a.max_user_quota || 1)) * 100),
          created_at: a.created_at,
        };
      }));

      const totalUsers = await prisma.user.count({
        where: { role: 'user', status: 'active' }
      });

      return {
        total_users: totalUsers,
        total_admins: admins.length,
        admins: adminStats,
      };
    } catch (err) {
      console.error('getAdminDashboard error:', err);
      return { total_users: 0, total_admins: 0, admins: [] };
    }
  }

  // ── Candidates (CACHED) ──
  async getSheetData(sheet, page = 1, limit = 50, user) {
    try {
      const sheetNames = await this.resolveTargetSheets(sheet, user);
      if (!sheetNames.length) return { total: 0, page, data: [] };

      const { matched, unmatched } = await this._resolveRegisteredSpreadsheets(sheetNames);

      // FAST PATH: every requested sheet lives in the Postgres cache →
      // paginate in SQL instead of loading all rows into memory.
      if (unmatched.length === 0 && matched.length > 0) {
        await this._ensureSynced(matched);
        const ids = matched.map(m => m.id);
        const nameById = Object.fromEntries(matched.map(m => [m.id, m.name]));
        const where = { spreadsheet_id: { in: ids } };
        const [total, rows] = await Promise.all([
          prisma.sheetRow.count({ where }),
          prisma.sheetRow.findMany({
            where,
            orderBy: [{ spreadsheet_id: 'asc' }, { tab_name: 'asc' }, { row_index: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
        ]);
        return {
          total, page,
          data: rows.map(r => ({ ...r.data, _sheet: nameById[r.spreadsheet_id], _tab_name: r.tab_name, _row_index: r.row_index })),
        };
      }

      // LEGACY PATH: unregistered sheets (auto-discovery) — in-memory pagination
      const allData = await this.getAllCandidateData(sheet, user);
      const total = allData.length;
      const start = (page - 1) * limit;
      return { total, page, data: allData.slice(start, start + limit) };
    } catch (err) {
      console.error(`Error fetching sheet ${sheet}:`, err);
      return { total: 0, page, data: [] };
    }
  }

  async getSheetSummary(user) {
    const nr = this.normalizeRole(user?.role);
    // super_admin gets a shared cache; admin and users get per-login caches
    const cacheKey = nr === 'super_admin' ? 'sheet-summary-admin' : `sheet-summary-${user?.login_id || 'anon'}`;

    return cache.getOrFetch(cacheKey, async () => {
      // 1. Get registry of all spreadsheets (Already cached metadata)
      const allRegistered = await this.getRegisteredSpreadsheets();

      // 2. Filter by user access — only super_admin sees all active sheets
      let visibleSheets = [];
      if (nr === 'super_admin') {
        visibleSheets = allRegistered.filter(s => s.is_active);
      } else if (user) {
        const grants = await prisma.userTabAccess.findMany({ where: { user_id: user.login_id } });
        const grantedSpreadsheetIds = new Set(grants.map(g => g.spreadsheet_id));
        visibleSheets = allRegistered.filter(s => s.is_active && grantedSpreadsheetIds.has(s.id));
      }

      const sheets = visibleSheets.map(s => {
        // Aggregate counts from tabs
        const tabCount = (s.tabs || []).reduce((acc, t) => acc + (t.row_count || 0), 0);
        return {
          name: s.name,
          count: tabCount,
          verified: 0 // verified_count not in current schema
        };
      });

      const grandTotal = sheets.reduce((acc, s) => acc + s.count, 0);

      return { 
        sheets, 
        added_this_month: 0, 
        total: grandTotal, 
        total_verified: 0 
      };
    }, 10 * 60 * 1000);
  }

  async addCandidate(sheet, candidate, added_by) {
    try {
      const spreadsheetId = await this.getSpreadsheetIdForTab(sheet);
      const rows = await sheetsAPI.getSheetDataFull(sheet, spreadsheetId);
      if (!rows.length) return { success: false, message: 'Sheet is empty or missing headers' };
      // Ensure audit columns exist; updates Google Sheet row 1 if needed
      const headers = await this._ensureAuditColumns(sheet, rows[0], spreadsheetId);

      // Build a row array the same length as headers, all empty
      const row = Array.from({ length: headers.length }, () => '');
      const today = new Date().toLocaleDateString('en-GB');

      // ── Dynamic field mapping: iterate every key in candidate ──
      // The candidate object keys should match sheet header names (case-insensitive)
      for (const [key, val] of Object.entries(candidate)) {
        if (val === undefined || val === null || val === '') continue;
        this.setIfHeaderExists(row, headers, [key], val);
      }

      // ── Auto-increment Sr. No if header exists ──
      const srIdx = this.resolveHeaderIndex(headers, ['Sr.', 'Sr', 'Sr No', 'Sr. No', 'S.No', 'SrNo']);
      if (srIdx >= 0) {
        const lastSrNo = rows.length > 1 ? (parseInt(rows[rows.length - 1][srIdx]) || 0) : 0;
        row[srIdx] = lastSrNo + 1;
      }

      // ── Audit columns: append at end if headers exist, else auto-add ──
      const createdByIdx = this.resolveHeaderIndex(headers, ['Created By', 'Added By']);
      const modifiedByIdx = this.resolveHeaderIndex(headers, ['Modified By', 'Updated By']);
      const createdAtIdx = this.resolveHeaderIndex(headers, ['Created At', 'Added On', 'Since']);
      const modifiedAtIdx = this.resolveHeaderIndex(headers, ['Modified At', 'Last Updated', 'Updated At']);

      if (createdByIdx >= 0) row[createdByIdx] = added_by || 'System';
      if (modifiedByIdx >= 0 && modifiedByIdx !== createdByIdx) row[modifiedByIdx] = added_by || 'System';
      if (createdAtIdx >= 0) row[createdAtIdx] = row[createdAtIdx] || today;
      if (modifiedAtIdx >= 0) row[modifiedAtIdx] = new Date().toISOString();

      await sheetsAPI.appendRow(`${sheet}!A:ZZ`, row, spreadsheetId);
      cache.invalidateSheetData();
      // Write-through: mirror the new row into the Postgres cache instantly
      await this._writeThroughUpsert(spreadsheetId, sheet, headers, row, rows.length, added_by);

      await this.logActivity({
        action: 'ROW_CREATED',
        actor: added_by || 'System',
        details: `Added row to ${sheet}`,
        after_snapshot: candidate,
        target_tab_name: sheet,
      });

      return { success: true, sr_no: srIdx >= 0 ? row[srIdx] : null };
    } catch (err) {
      console.error('Add Candidate Error:', err);
      return { success: false, message: 'Could not add row: ' + err.message };
    }
  }

  async logActivity({ action, actor, details, before_snapshot, after_snapshot, target_tab_name, ip_address } = {}) {
    try {
      // Ensure actor exists in User table for foreign key constraint
      let validActorId = actor || 'system';
      const actorExists = await prisma.user.findUnique({ where: { login_id: validActorId } });
      
      if (!actorExists) {
        // Fallback to the first super_admin found for system actions
        const superAdmin = await prisma.user.findFirst({ where: { role: 'super_admin' } });
        validActorId = superAdmin ? superAdmin.login_id : 'system';
      }

      // Only attempt Prisma log if we have a valid actor in the DB
      if (validActorId !== 'system') {
        await prisma.auditLog.create({
          data: {
            actor_id:          validActorId,
            actor_name:        actor || 'System',
            actor_role:        'system',
            action_type:       action || 'UNKNOWN',
            target_tab_name:   target_tab_name || null,
            before_snapshot:   before_snapshot || undefined,
            after_snapshot:    after_snapshot  || undefined,
            ip_address:        ip_address      || null,
            metadata:          details ? { details } : undefined,
          },
        });
      }
    } catch (err) {
      // Never crash the main flow due to audit failure
      console.warn('logActivity (Prisma) warning:', err.message);
    }
    // Always mirror to Google Sheet ActivityLog (fire-and-forget)
    this._appendActivityToSheet(action, actor, details).catch(() => {});
  }

  async getActivityLog(page = 1, limit = 50) {
    // Read from Prisma first (authoritative); fall back to Google Sheet
    try {
      const total = await prisma.auditLog.count();
      const start = (page - 1) * limit;
      const logs = await prisma.auditLog.findMany({
        orderBy: { created_at: 'desc' },
        skip: start,
        take: limit,
        select: { action_type: true, actor_name: true, metadata: true, created_at: true, target_tab_name: true }
      });
      return {
        total,
        logs: logs.map(l => ({
          Action: l.action_type,
          User: l.actor_name,
          Details: l.metadata?.details || '',
          Timestamp: l.created_at?.toISOString() || '',
          Tab: l.target_tab_name || '',
        }))
      };
    } catch {
      const rows = await sheetsAPI.getSheetData('ActivityLog!A:D');
      const allLogs = sheetsAPI.rowsToObjects(rows);
      const total = allLogs.length;
      const start = (page - 1) * limit;
      return { total, logs: allLogs.slice(start, start + limit).reverse() };
    }
  }

  // ── Smart Search — searches ALL row keys dynamically (no hardcoded fields) ──
  smartSearch(allData, query) {
    if (!query || !query.trim()) return allData;
    const cleanQuery = query.toLowerCase().replace(/,/g, ' ').replace(/[^\w\s-]/g, ' ').trim();
    // Exclude common connector stop-words so they don't block valid results
    const STOP_WORDS = new Set(['in', 'on', 'at', 'for', 'with', 'and', 'to', 'a', 'the', 'of', 'is', 'are', 'from']);
    const tokens = cleanQuery.split(/\s+/).filter(t => t && !STOP_WORDS.has(t));
    if (!tokens.length) return allData;

    const scored = [];
    const queryLower = query.toLowerCase().trim();

    for (let i = 0; i < allData.length; i++) {
      const item = allData[i];
      let score = 0;
      let matchedTokensCount = 0;

      // 1. Fast property extraction (zero entries/values allocations)
      const fieldsMap = {};
      const fieldValues = [];
      for (const key in item) {
        if (key.startsWith('_')) continue;
        const val = item[key];
        if (val === undefined || val === null || val === '') continue;
        const strVal = String(val).toLowerCase();
        fieldsMap[key] = strVal;
        fieldValues.push(strVal);
      }

      const searchableText = fieldValues.join(' ');

      // Exact full query match in any field = highest score
      if (searchableText.includes(queryLower)) score += 100;

      // 2. Per-token matching with early exit
      let allTokensMatched = true;
      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        let tokenMatched = false;

        // Field check
        for (const key in fieldsMap) {
          const strVal = fieldsMap[key];

          if (key === 'gender') {
            // Strict exact match for gender field to prevent "male" matching "female"
            if (strVal === token) {
              score += 15;
              tokenMatched = true;
              break;
            }
          } else {
            if (strVal === token) {
              score += 10;
              if (key === 'name') score += 20;
              if (key === 'area') score += 15;
              tokenMatched = true;
              break;
            } else if (strVal.includes(token)) {
              const words = strVal.split(/\s+/);
              if (words.includes(token)) {
                score += 8;
                if (key === 'name') score += 15;
                if (key === 'area') score += 10;
              } else {
                score += 4;
              }
              tokenMatched = true;
              break;
            }
          }
        }

        // Fuzzy match fallback — limited to primary searchable columns for speed
        if (!tokenMatched) {
          const fuzzyFields = ['name', 'area', 'experience'];
          for (let f = 0; f < fuzzyFields.length; f++) {
            const val = fieldsMap[fuzzyFields[f]];
            if (!val) continue;
            const words = val.split(/\s+/);
            for (let w = 0; w < words.length; w++) {
              const word = words[w];
              if (word.length > 2 && token.length > 2 && this.fuzzyMatch(token, word)) {
                score += 3;
                tokenMatched = true;
                break;
              }
            }
            if (tokenMatched) break;
          }
        }

        if (tokenMatched) {
          matchedTokensCount++;
        } else {
          // EARLY EXIT: Save massive CPU cycles by discarding mismatching candidates immediately
          allTokensMatched = false;
          break;
        }
      }

      if (!allTokensMatched) continue;

      // 3. Intent detection: only executed for candidates that match all tokens
      // Intent detection: age ranges
      const ageMatch = query.toLowerCase().match(/(\d+)\s*[-–to]+\s*(\d+)\s*(year|yr|age)?/i);
      if (ageMatch) {
        const minAge = parseInt(ageMatch[1]);
        const maxAge = parseInt(ageMatch[2]);
        const age = parseInt(item.age) || 0;
        if (age >= minAge && age <= maxAge) score += 30;
      } else {
        const singleAgeMatch = query.toLowerCase().match(/(age\s*(\d+))|((\d+)\s*(year|yr)\s*old)/i);
        if (singleAgeMatch) {
          const targetAge = parseInt(singleAgeMatch[2] || singleAgeMatch[4]);
          const age = parseInt(item.age) || 0;
          if (age === targetAge) score += 30;
        }
      }

      // Intent: salary range  
      const salaryMatch = query.toLowerCase().match(/(\d+)\s*k?\s*[-–to]+\s*(\d+)\s*k?\s*(salary|pay|rupee|₹)?/i);
      if (salaryMatch) {
        let minSal = parseInt(salaryMatch[1]);
        let maxSal = parseInt(salaryMatch[2]);
        if (minSal < 1000) minSal *= 1000;
        if (maxSal < 1000) maxSal *= 1000;
        const sal = parseInt(item.salary) || 0;
        if (sal >= minSal && sal <= maxSal) score += 30;
      } else {
        const singleSalaryMatch = query.toLowerCase().match(/(salary|pay|rupee|₹)\s*(\d+)\s*k?/i) || query.toLowerCase().match(/(\d+)\s*k?\s*(salary|pay|rupee|₹)/i);
        if (singleSalaryMatch) {
          let targetSal = parseInt(singleSalaryMatch[2] || singleSalaryMatch[1]);
          if (query.toLowerCase().includes('k')) targetSal *= 1000;
          const sal = parseInt(item.salary) || 0;
          if (sal > 0 && Math.abs(sal - targetSal) / targetSal <= 0.2) score += 30;
        }
      }

      // Intent: experience
      const expMatch = query.toLowerCase().match(/(\d+)\+?\s*(year|yr|exp)/i);
      if (expMatch) {
        const years = parseInt(expMatch[1]);
        const exp = String(item.experience || '').toLowerCase();
        const parsedExp = parseInt(exp.replace(/\D/g, '')) || 0;
        if (parsedExp >= years || (exp.includes('10+') && years <= 10)) score += 20;
      }

      scored.push({ ...item, _score: score });
    }

    return scored
      .sort((a, b) => b._score - a._score)
      .map(({ _score, ...item }) => item);
  }

  fuzzyMatch(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    // Simple Levenshtein distance <= 1
    let diffs = 0;
    const maxLen = Math.max(a.length, b.length);
    let ai = 0, bi = 0;
    while (ai < a.length && bi < b.length) {
      if (a[ai] !== b[bi]) {
        diffs++;
        if (diffs > 1) return false;
        if (a.length > b.length) ai++;
        else if (b.length > a.length) bi++;
        else { ai++; bi++; }
      } else { ai++; bi++; }
    }
    return diffs + (a.length - ai) + (b.length - bi) <= 1;
  }

  // ── Filters — AND logic: every active condition must match ──
  /** Tokenize a search query the same way smartSearch does (stop-words removed) */
  _searchTokens(query) {
    if (!query || !query.trim()) return [];
    const STOP_WORDS = new Set(['in', 'on', 'at', 'for', 'with', 'and', 'to', 'a', 'the', 'of', 'is', 'are', 'from']);
    return query.toLowerCase().replace(/,/g, ' ').replace(/[^\w\s-]/g, ' ').trim()
      .split(/\s+/).filter(t => t && !STOP_WORDS.has(t));
  }

  async applyFilters(sheet, filters, page = 1, limit = 50, user, tab = null) {
    try {
      // FAST PATH: pure text search (no column/salary filters) on Postgres-cached
      // sheets → filter and paginate in SQL via search_vector.
      const hasColumnFilters = filters.columns && typeof filters.columns === 'object'
        && Object.values(filters.columns).some(v => v && v.length);
      const hasLegacyFilters = Object.entries(filters).some(([k, v]) =>
        !['search', 'salary_min', 'salary_max', 'columns'].includes(k) && Array.isArray(v) && v.length);
      const hasSalaryFilters = !!(filters.salary_min || filters.salary_max);

      if (!hasColumnFilters && !hasLegacyFilters && !hasSalaryFilters) {
        const sheetNames = await this.resolveTargetSheets(sheet, user);
        if (!sheetNames.length) return { total: 0, page, data: [] };
        const { matched, unmatched } = await this._resolveRegisteredSpreadsheets(sheetNames);

        if (unmatched.length === 0 && matched.length > 0) {
          await this._ensureSynced(matched);
          const ids = matched.map(m => m.id);
          const nameById = Object.fromEntries(matched.map(m => [m.id, m.name]));
          const tokens = this._searchTokens(filters.search);
          const where = {
            spreadsheet_id: { in: ids },
            ...(tab ? { tab_name: tab } : {}),
            ...(tokens.length ? { AND: tokens.map(t => ({ search_vector: { contains: t } })) } : {}),
          };
          const [total, rows] = await Promise.all([
            prisma.sheetRow.count({ where }),
            prisma.sheetRow.findMany({
              where,
              orderBy: [{ spreadsheet_id: 'asc' }, { tab_name: 'asc' }, { row_index: 'asc' }],
              skip: (page - 1) * limit,
              take: limit,
            }),
          ]);
          return {
            total, page,
            data: rows.map(r => ({ ...r.data, _sheet: nameById[r.spreadsheet_id], _tab_name: r.tab_name, _row_index: r.row_index })),
          };
        }
      }

      // LEGACY PATH: column/salary filters or unregistered sheets — in-memory
      let allData = await this.getAllCandidateData(sheet, user);

      // Tab filter — narrow to a specific Google Sheets tab
      if (tab) {
        allData = allData.filter(item => item._tab_name === tab);
      }

      // Smart text search (must match all tokens)
      if (filters.search) {
        allData = this.smartSearch(allData, filters.search);
      }

      const templateItem = allData[0];

      // Dynamic column filters — filters.columns is { [headerName]: value[] }
      // Each key in filters.columns narrows the result (AND between keys, OR within values)
      if (templateItem && filters.columns && typeof filters.columns === 'object') {
        for (const [col, allowedValues] of Object.entries(filters.columns)) {
          if (!allowedValues || !allowedValues.length) continue;
          
          // Pre-compile criteria once
          const allowed = allowedValues.map(v => String(v).toLowerCase());
          const targetCol = col.toLowerCase().replace(/[^a-z0-9]/g, '');
          const itemKey = Object.keys(templateItem).find(k => 
            k.toLowerCase().replace(/[^a-z0-9]/g, '') === targetCol
          );

          if (!itemKey) continue;

          // Zero-allocation loop property check
          allData = allData.filter(item => {
            const val = item[itemKey];
            if (val === undefined || val === null || val === '') return false;
            return allowed.includes(String(val).toLowerCase());
          });
        }
      }

      // Legacy named filters (kept for backwards compatibility with existing frontend)
      if (templateItem) {
        for (const [filterKey, filterVals] of Object.entries(filters)) {
          if (!filterVals?.length || ['search', 'salary_min', 'salary_max', 'columns'].includes(filterKey)) continue;
          
          // Pre-compile criteria once
          const allowed = filterVals.map(v => String(v).toLowerCase());
          const normalizedKey = filterKey.toLowerCase().replace(/[^a-z0-9]+/g, '_');
          const itemKey = Object.keys(templateItem).find(k => 
            k.toLowerCase().replace(/[^a-z0-9]+/g, '_') === normalizedKey
          );

          if (!itemKey) continue;

          // Zero-allocation loop property check
          allData = allData.filter(item => {
            const val = item[itemKey];
            if (val === undefined || val === null || val === '') return false;
            return allowed.includes(String(val).toLowerCase());
          });
        }
      }
      
      if (filters.salary_min) allData = allData.filter(item => Number(item.salary || 0) >= Number(filters.salary_min));
      if (filters.salary_max) allData = allData.filter(item => Number(item.salary || 0) <= Number(filters.salary_max));

      const total = allData.length;
      const start = (page - 1) * limit;
      return { total, page, data: allData.slice(start, start + limit) };
    } catch (err) {
      console.error('Apply Filters Error:', err);
      return { total: 0, page: 1, data: [] };
    }
  }

  // Dynamic filter options — builds from all actual column keys in the data
  async getFilterOptions(sheet, user) {
    const cacheKey = `filter-opts:${sheet || 'all'}-${user?.login_id || 'anon'}`;
    return cache.getOrFetch(cacheKey, async () => {
      try {
        const allData = await this.getAllCandidateData(sheet, user);
        // Exclude fields that are high-cardinality or unfilterable to avoid blocking event loop & JSON bloat
        const EXCLUDED_FIELDS = /email|phone|mobile|contact|website|web|url|name|desc|note|remark|sr_no|sr|s_no|id|charges|salary|address|since|created_at|updated_at|modified_at|dob|age/i;

        // Collect unique values for every column dynamically
        const columnSets = {};
        for (const item of allData) {
          for (const [key, val] of Object.entries(item)) {
            if (key.startsWith('_') || !val || val === '') continue;
            if (EXCLUDED_FIELDS.test(key)) continue;
            if (!columnSets[key]) columnSets[key] = new Set();
            columnSets[key].add(String(val));
          }
        }
        const result = {};
        for (const [k, v] of Object.entries(columnSets)) {
          // If cardinality is greater than 100, do not return filter options (no human can select from 100+ checkboxes)
          if (v.size > 100) continue;
          result[k] = Array.from(v).sort();
        }
        return result;
      } catch (err) {
        console.error('Get Filter Options Error:', err);
        return {};
      }
    }, 5 * 60 * 1000);
  }

  async editCandidate(sr_no, row_index, sheet, target_sheet, updated_fields, updated_by) {
    try {
      // _tab_name is the actual Google Sheets tab (e.g. "Inventory").
      // sheet may be the spreadsheet display name (e.g. "Restro Database") — not a valid tab.
      const tabName = updated_fields?._tab_name || sheet;
      const spreadsheetId = await this.getSpreadsheetIdForTab(sheet) || await this.getSpreadsheetIdForTab(tabName);
      const rows = await sheetsAPI.getSheetDataFull(tabName, spreadsheetId);
      if (!rows.length) return { success: false, message: 'Sheet is empty' };
      // Ensure audit columns exist; updates Google Sheet row 1 if needed
      const originalHeaders = await this._ensureAuditColumns(tabName, rows[0], spreadsheetId);

      // Find the row
      let rowIndex = -1;
      if (row_index !== undefined && row_index !== null && row_index !== 'undefined') {
        rowIndex = parseInt(row_index);
      } else if (sr_no && sr_no !== 0 && sr_no !== 'undefined') {
        rowIndex = await sheetsAPI.findRowIndexByAliases(tabName, ['Sr.', 'Sr', 'Sr. No', 'Sr No', 'S.No'], String(sr_no), spreadsheetId);
      }
      if (rowIndex === -1 || isNaN(rowIndex)) return { success: false, message: 'Row not found' };

      // Copy existing row (fill missing cols with '')
      const existingRow = Array.from({ length: originalHeaders.length }, (_, i) =>
        rows[rowIndex][i] !== undefined ? rows[rowIndex][i] : ''
      );

      // Capture before-snapshot for audit
      const beforeSnapshot = {};
      originalHeaders.forEach((h, i) => { beforeSnapshot[h] = existingRow[i]; });

      // ── Dynamic update: iterate every key in updated_fields ──
      for (const [key, val] of Object.entries(updated_fields)) {
        if (key.startsWith('_')) continue; // skip internal fields
        this.setIfHeaderExists(existingRow, originalHeaders, [key], val);
      }

      // ── Audit: update Modified By + Modified Date ONLY (never touch Created By/Date) ──
      const modifiedByIdx = this.resolveHeaderIndex(originalHeaders, ['Modified By', 'Updated By']);
      const modifiedAtIdx = this.resolveHeaderIndex(originalHeaders, ['Modified At', 'Last Updated', 'Updated At']);
      if (modifiedByIdx >= 0) existingRow[modifiedByIdx] = updated_by || 'System';
      if (modifiedAtIdx >= 0) existingRow[modifiedAtIdx] = new Date().toISOString();

      if (target_sheet && target_sheet !== sheet) {
        const targetSpreadsheetId = await this.getSpreadsheetIdForTab(target_sheet) || spreadsheetId;
        await sheetsAPI.appendRow(`${target_sheet}!A:ZZ`, existingRow, targetSpreadsheetId);
        await sheetsAPI.deleteRow(tabName, rowIndex, spreadsheetId);
        await this._writeThroughDelete(spreadsheetId, tabName, rowIndex);
        if (targetSpreadsheetId) this.syncSpreadsheet(targetSpreadsheetId).catch(() => {});
      } else {
        await sheetsAPI.updateRow(tabName, rowIndex, existingRow, spreadsheetId);
        await this._writeThroughUpsert(spreadsheetId, tabName, originalHeaders, existingRow, rowIndex, updated_by);
      }

      cache.invalidateSheetData();

      const afterSnapshot = {};
      originalHeaders.forEach((h, i) => { afterSnapshot[h] = existingRow[i]; });

      await this.logActivity({
        action: 'ROW_UPDATED',
        actor: updated_by || 'System',
        details: `Updated row ${sr_no} in ${tabName} (${sheet})`,
        before_snapshot: beforeSnapshot,
        after_snapshot: afterSnapshot,
        target_tab_name: tabName,
      });

      return { success: true };
    } catch (err) {
      console.error('Edit Candidate Error:', err);
      return { success: false, message: 'Failed to update candidate information.' };
    }
  }

  async removeCandidate(sr_no, row_index, sheet, removed_by) {
    try {
      const spreadsheetId = await this.getSpreadsheetIdForTab(sheet);
      
      let rowIndexToDelete = -1;
      
      if (row_index !== undefined && row_index !== null && row_index !== 'undefined') {
        // row_index from frontend corresponds to the physical data row index (1-based from sheet headers).
        rowIndexToDelete = parseInt(row_index);
      } else {
        // Fallback: search by Sr. No
        rowIndexToDelete = await sheetsAPI.findRowIndexByAliases(sheet, ['Sr.', 'Sr', 'Sr. No', 'Sr No'], String(sr_no), spreadsheetId);
      }

      if (rowIndexToDelete === -1 || isNaN(rowIndexToDelete)) return { success: false, message: 'Candidate not found in sheet' };
      
      await sheetsAPI.deleteRow(sheet, rowIndexToDelete, spreadsheetId);
      cache.invalidateSheetData();
      // Write-through: remove the row from the Postgres cache instantly
      await this._writeThroughDelete(spreadsheetId, sheet, rowIndexToDelete);
      await this.logActivity({ 
        action: 'ROW_DELETED', 
        actor: removed_by || 'System', 
        details: `Removed candidate (Row: ${rowIndexToDelete}) from ${sheet}`,
        target_tab_name: sheet
      });
      return { success: true };
    } catch (err) {
      console.error('Remove Candidate Error:', err);
      return { success: false, message: 'Delete failed' };
    }
  }

  async checkMobile(mobile, exclude_sr_no, user) {
    const allData = await this.getAllCandidateData('all', user);
    const duplicate = allData.find(c => String(c.mobile) === String(mobile) && String(c.sr_no) !== String(exclude_sr_no));
    if (duplicate) return { exists: true, sheet: duplicate.sheet || duplicate._sheet, name: duplicate.name };
    return { exists: false };
  }

  async changePassword(login_id, old_password, new_password) {
    try {
      const user = await prisma.user.findUnique({ where: { login_id } });
      if (!user) return { success: false, message: 'User not found' };

      const isMatch = await comparePassword(old_password, user.password);
      if (!isMatch) return { success: false, message: 'Incorrect old password' };

      const hashedPassword = await hashPassword(new_password);
      await prisma.user.update({
        where: { login_id },
        data: { password: hashedPassword }
      });
      
      await this.logActivity({
        action: 'PASSWORD_CHANGED',
        actor: login_id,
        details: `User changed their own password`
      });
      return { success: true };
    } catch (err) {
      console.error('Change Password Error:', err);
      return { success: false, message: 'Update failed' };
    }
  }

  async resetPassword(target_login_id, reset_by) {
    // Generate a strong temp password: 2 uppercase + 2 digits + 6 random chars
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const rand = (s) => s[Math.floor(Math.random() * s.length)];
    const core = [rand(upper), rand(upper), rand(digits), rand(digits),
      ...Array.from({ length: 6 }, () => rand(lower + upper + digits))];
    const new_password = core.sort(() => Math.random() - 0.5).join('');

    const hashedPassword = await hashPassword(new_password);
    const user = await prisma.user.findUnique({ where: { login_id: target_login_id } });
    if (!user) return { success: false, message: 'User not found' };

    await prisma.user.update({
      where: { login_id: target_login_id },
      data: { password: hashedPassword }
    });
    await this.logActivity({
      action: 'PASSWORD_RESET',
      actor: reset_by,
      details: `Password reset for ${target_login_id}`
    });

    // Sync updated password hash to Google Sheet
    const updatedUser = await prisma.user.findUnique({ where: { login_id: target_login_id }, include: { tabAccess: true } });
    if (updatedUser) {
      this._syncUserToSheet({ ...updatedUser, password_hash: hashedPassword, sheet_access: updatedUser.tabAccess.map(a => a.tab_name) }).catch(() => {});
    }
    this._appendActivityToSheet('PASSWORD_RESET', reset_by, `Password reset for ${target_login_id}`).catch(() => {});

    return { success: true, new_password };
  }

  async updateUserRole(target_login_id, role, updated_by) {
    const normalizedRole = this.normalizeRole(role);
    await prisma.user.update({
      where: { login_id: target_login_id },
      data: { role: normalizedRole }
    });
    
    await this.logActivity({ 
      action: 'UPDATE_ROLE', 
      actor: updated_by, 
      details: `Updated role for ${target_login_id} to ${normalizedRole}` 
    });
    
    return { success: true };
  }

  async toggleUserStatus(target_login_id, updated_by) {
    const user = await prisma.user.findUnique({ where: { login_id: target_login_id } });
    if (!user) return { success: false, message: 'User not found' };
    
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    await prisma.user.update({
      where: { login_id: target_login_id },
      data: { status: newStatus }
    });
    
    await this.logActivity({ 
      action: 'TOGGLE_STATUS', 
      actor: updated_by, 
      details: `Changed status for ${target_login_id} to ${newStatus}` 
    });
    
    return { success: true, status: newStatus };
  }

  async syncAllSpreadsheets() {
    return this.syncAllActiveSpreadsheets();
  }

  async updateUserLimit(target_login_id, max_users, updated_by) {
    await prisma.user.update({
      where: { login_id: target_login_id },
      data: { max_user_quota: parseInt(max_users) || 10 }
    });
    
    await this.logActivity({
      action: 'UPDATE_QUOTA',
      actor: updated_by,
      details: `Updated max user quota for ${target_login_id} to ${max_users}`
    });
    return { success: true };
  }

  // ── Google Sheets Integration (Prisma-backed Registry) ──
  async getRegisteredSpreadsheets() {
    try {
      const spreadsheets = await prisma.spreadsheet.findMany({
        where: { is_active: true },
        include: { tabs: true }
      });
      return spreadsheets.map(s => ({
        ...s,
        tab_name: s.tabs.length > 0 ? s.tabs[0].tab_name : 'No Tabs',
        columns: s.tabs.length > 0 ? s.tabs[0].headers : []
      }));
    } catch (e) {
      console.error('getRegisteredSpreadsheets error:', e.message);
      return [];
    }
  }

  async addSpreadsheet(sheet_id, added_by) {
    try {
      const metadata = await sheetsAPI.getSpreadsheetMetadata(sheet_id);
      const title = metadata.properties.title;
      
      const ss = await prisma.spreadsheet.upsert({
        where: { sheet_id },
        update: { name: title, is_active: true },
        create: {
          sheet_id,
          name: title,
          owner_id: added_by || 'system',
          is_active: true
        }
      });

      const tabsData = [];
      for (const sheet of metadata.sheets) {
        const tabName = sheet.properties.title;
        if (EXCLUDED_SHEETS.has(tabName.toLowerCase())) continue;
        
        let columns = [];
        try {
          const rows = await sheetsAPI.getSheetData(`'${tabName}'!A1:Z1`, sheet_id);
          const headers = rows && rows.length > 0 ? rows[0] : [];
          columns = headers.map((h, i) => ({ name: h ? String(h).trim() : `col_${i + 1}`, index: i, type: 'string' }));
        } catch (err) {}

        tabsData.push({
          spreadsheet_id: ss.id,
          tab_name: tabName,
          headers: columns
        });
      }
      
      if (tabsData.length > 0) {
        // Use individual creates to handle existing tabs via Upsert or skip
        for (const tab of tabsData) {
          await prisma.spreadsheetTab.upsert({
            where: {
              spreadsheet_id_tab_name: {
                spreadsheet_id: tab.spreadsheet_id,
                tab_name: tab.tab_name
              }
            },
            update: { headers: tab.headers },
            create: tab
          });
        }
      }
      
      cache.invalidateSheetData();
      await this.logActivity({ action: 'REGISTER_SHEET', actor: added_by, details: `Registered spreadsheet: ${title} (${sheet_id})` });
      
      return { success: true, title, tabs: tabsData.map(t => t.tab_name), registered_count: tabsData.length };
    } catch (e) {
      return { success: false, message: 'Failed to register spreadsheet.' };
    }
  }

  async removeSpreadsheet(sheet_id, removed_by) {
    try {
      const ss = await prisma.spreadsheet.update({
        where: { sheet_id },
        data: { is_active: false }
      });
      // DATA POLICY: purge all cached rows immediately — Google Sheets stays
      // the only permanent home of the data once a sheet is disconnected.
      const purged = await prisma.sheetRow.deleteMany({ where: { spreadsheet_id: ss.id } });
      cache.invalidateSheetData();
      await this.logActivity({
        action: 'UNREGISTER_SHEET',
        actor: removed_by,
        details: `Removed spreadsheet ${sheet_id}; purged ${purged.count} cached rows`,
      });
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  /**
   * DATA POLICY: safety-net purge — deletes any cached rows still belonging to
   * inactive (disconnected) spreadsheets. Run daily from server.js.
   */
  async purgeStaleSheetRows() {
    try {
      const inactive = await prisma.spreadsheet.findMany({
        where: { is_active: false },
        select: { id: true },
      });
      if (!inactive.length) return { purged: 0 };
      const res = await prisma.sheetRow.deleteMany({
        where: { spreadsheet_id: { in: inactive.map(s => s.id) } },
      });
      if (res.count) console.log(`[Purge] Removed ${res.count} cached rows from inactive spreadsheets`);
      return { purged: res.count };
    } catch (e) {
      console.error('purgeStaleSheetRows error:', e);
      return { purged: 0 };
    }
  }

  async syncSpreadsheet(sheet_id) {
    if (activeSyncs.has(sheet_id)) {
      return activeSyncs.get(sheet_id);
    }
    const syncPromise = this._syncSpreadsheetInternal(sheet_id).finally(() => {
      activeSyncs.delete(sheet_id);
    });
    activeSyncs.set(sheet_id, syncPromise);
    return syncPromise;
  }

  async _syncSpreadsheetInternal(sheet_id) {
    try {
      const ss = await prisma.spreadsheet.findUnique({
        where: { sheet_id },
        include: { tabs: true }
      });
      if (!ss) return { success: false, message: `Spreadsheet not registered: ${sheet_id}` };

      // ── Step 1: Discover current tabs from Google Sheets (source of truth) ──
      let liveTabNames;
      try {
        liveTabNames = await sheetsAPI.getSheetNames(sheet_id);
      } catch (e) {
        return { success: false, message: `Could not read spreadsheet tabs: ${e.message}` };
      }

      // Filter out system/excluded tabs
      const candidateTabNames = liveTabNames.filter(n => !EXCLUDED_SHEETS.has(String(n).toLowerCase().trim()));
      console.log(`[Sync] ${ss.name} — live tabs: [${candidateTabNames.join(', ')}]`);

      // ── Step 2: Reconcile SpreadsheetTab with live reality ──
      const existingTabMap = new Map(ss.tabs.map(t => [t.tab_name, t]));
      const liveSet = new Set(candidateTabNames);

      // Add newly discovered tabs
      for (const tabName of candidateTabNames) {
        if (!existingTabMap.has(tabName)) {
          console.log(`[Sync] New tab discovered: "${tabName}" — registering`);
          const newTab = await prisma.spreadsheetTab.create({
            data: { spreadsheet_id: ss.id, tab_name: tabName }
          });
          existingTabMap.set(tabName, newTab);
        }
      }

      // Remove tabs that no longer exist in Google Sheets
      for (const [tabName, tab] of existingTabMap) {
        if (!liveSet.has(tabName)) {
          console.log(`[Sync] Tab "${tabName}" gone from Google Sheets — removing from registry`);
          await prisma.sheetRow.deleteMany({ where: { spreadsheet_id: ss.id, tab_name: tabName } });
          await prisma.userTabAccess.deleteMany({ where: { spreadsheet_id: ss.id, tab_name: tabName } });
          await prisma.spreadsheetTab.delete({ where: { id: tab.id } });
          existingTabMap.delete(tabName);
        }
      }

      // ── Step 3: Sync row data for every live tab ──
      const results = [];
      for (const tabName of candidateTabNames) {
        try {
          const sheetData = await sheetsAPI.getSheetDataFull(tabName, sheet_id);
          if (!sheetData || sheetData.length < 1) {
            console.log(`[Sync] Tab "${tabName}" is empty — skipping`);
            results.push({ tab: tabName, synced: 0 });
            continue;
          }

          let headers = sheetData[0];
          // Ensure every tab has "Updated By" and "Updated At" columns
          headers = await this._ensureAuditColumns(tabName, headers, sheet_id);
          const dataRows = sheetData.slice(1).filter(r => r.some(c => String(c || '').trim()));

          const rowsToInsert = dataRows.map((dr, index) => ({
            spreadsheet_id: ss.id,
            tab_name: tabName,
            row_index: index + 1,
            data: this._buildRowData(headers, dr, index),
            search_vector: dr.map(c => String(c || '')).join(' ').toLowerCase(),
          }));

          await prisma.$transaction(async (tx) => {
            await tx.sheetRow.deleteMany({ where: { spreadsheet_id: ss.id, tab_name: tabName } });
            if (rowsToInsert.length > 0) {
              const CHUNK = 5000;
              for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
                await tx.sheetRow.createMany({ data: rowsToInsert.slice(i, i + CHUNK) });
              }
            }
          }, { timeout: 120_000 });

          // Update header cache + row count on the tab record
          const tab = existingTabMap.get(tabName);
          if (tab) {
            const colDefs = headers.map((h, i) => ({ name: h ? String(h).trim() : `col_${i+1}`, index: i, type: 'string' }));
            await prisma.spreadsheetTab.update({
              where: { id: tab.id },
              data: { headers: colDefs, row_count: dataRows.length, last_synced_at: new Date() }
            });
          }

          console.log(`[Sync] "${tabName}" — ${dataRows.length} rows synced`);
          results.push({ tab: tabName, synced: dataRows.length });
        } catch (tabErr) {
          console.error(`[Sync] Error syncing tab "${tabName}":`, tabErr.message);
          results.push({ tab: tabName, error: tabErr.message });
        }
      }

      await prisma.spreadsheet.update({ where: { id: ss.id }, data: { last_synced_at: new Date() } });
      cache.invalidateSheetData();
      cache.invalidate(/^sheet-names-/);
      return { success: true, results };
    } catch (e) {
      console.error('[Sync] Fatal error:', e);
      return { success: false, message: e.message };
    }
  }

  // prismaId = Postgres UUID from the spreadsheet table
  // Returns { headers: [{ key, label }], data: [...] }
  // headers preserves the original Google Sheets column order and names
  async getSheetDataForSpreadsheet(prismaId) {
    const cacheKey = `raw-sheet-data:${prismaId}`;
    return cache.getOrFetch(cacheKey, async () => {
      try {
        const ss = await prisma.spreadsheet.findUnique({
          where: { id: prismaId },
          include: { tabs: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } } }
        });
        if (!ss) return { tabs: [] };

        let rows = await prisma.sheetRow.findMany({
          where: { spreadsheet_id: ss.id },
          orderBy: { id: 'asc' }
        });

        if (rows.length === 0) {
          const syncRes = await this.syncSpreadsheet(ss.sheet_id);
          if (syncRes.success) {
            rows = await prisma.sheetRow.findMany({
              where: { spreadsheet_id: ss.id },
              orderBy: { id: 'asc' }
            });
          }
        }

        // Group rows by tab_name
        const rowsByTab = {};
        for (const r of rows) {
          const t = r.tab_name || ss.tab_name || 'Sheet';
          if (!rowsByTab[t]) rowsByTab[t] = [];
          rowsByTab[t].push(r);
        }

        // Build per-tab result in the order tabs were discovered
        const tabs = ss.tabs.map(tab => {
          const tabRows = rowsByTab[tab.tab_name] || [];
          const headers = Array.isArray(tab.headers)
            ? tab.headers
                .sort((a, b) => a.index - b.index)
                .map(h => ({
                  key: this._normalizeHeaderKey(h.name, h.index),
                  label: h.name || `Col ${h.index + 1}`,
                }))
            : [];
          // If tab has no stored headers, derive from row data keys
          const effectiveHeaders = headers.length
            ? headers
            : tabRows.length
              ? Object.keys(tabRows[0].data || {}).map(k => ({ key: k, label: k }))
              : [];
          return {
            name: tab.tab_name,
            headers: effectiveHeaders,
            data: tabRows.map(r => r.data),
          };
        });

        // Include any tabs that have rows but were not in SpreadsheetTab (edge case)
        for (const [tabName, tabRows] of Object.entries(rowsByTab)) {
          if (!tabs.find(t => t.name === tabName)) {
            const keys = Object.keys(tabRows[0]?.data || {});
            tabs.push({
              name: tabName,
              headers: keys.map(k => ({ key: k, label: k })),
              data: tabRows.map(r => r.data),
            });
          }
        }

        // Legacy compat: also expose flat headers/data for callers that expect the old shape
        const firstTab = tabs[0] || { headers: [], data: [] };
        return { tabs, headers: firstTab.headers, data: firstTab.data };
      } catch (e) {
        console.error('getSheetDataForSpreadsheet error:', e);
        return { tabs: [], headers: [], data: [] };
      }
    }, 10 * 1000);
  }

  // Cron-like function to sync all active spreadsheets
  async syncAllActiveSpreadsheets() {
    try {
      const sheets = await this.getRegisteredSpreadsheets();
      for (const sheet of sheets) {
        if (sheet.is_active) {
          const lastSynced = sheet.last_synced_at ? new Date(sheet.last_synced_at) : new Date(0);
          const now = new Date();
          const minutesSinceSync = (now - lastSynced) / 1000 / 60;
          const syncInterval = sheet.sync_interval_minutes ?? 60;
          if (minutesSinceSync >= syncInterval) {
            console.log(`Auto-syncing spreadsheet: ${sheet.name} (${sheet.sheet_id})`);
            await this.syncSpreadsheet(sheet.sheet_id);
          }
        }
      }
    } catch (e) {
      console.error('syncAllActiveSpreadsheets error:', e);
    }
  }

  // ── Bulk CSV Import — fully dynamic, adapts to any sheet's columns ──
  async bulkImport(sheet, records, added_by) {
    try {
      if (!records.length) return { success: false, message: 'CSV is empty' };

      const csvHeaders = Object.keys(records[0]);

      // Use the sheet's existing headers; if the sheet is new, create it with the CSV's own headers
      let rows = await sheetsAPI.getSheetDataFull(sheet);
      if (!rows.length || !rows[0]?.length) {
        await sheetsAPI.ensureSheetExists(sheet, csvHeaders);
        rows = await sheetsAPI.getSheetDataFull(sheet);
      }
      if (!rows.length) return { success: false, message: 'Target sheet not found' };
      const headers = rows[0];

      // Build mapping: sheetHeader -> csvColumn
      let mapping = {};
      if (process.env.MISTRAL_API_KEY) {
        mapping = await this._getSmartMappingDynamic(csvHeaders, headers, records.slice(0, 4));
        console.log('[Bulk Import] AI mapping:', mapping);
      }
      // Fuzzy fallback for any sheet column not covered by AI
      const fuzzy = this._buildFuzzyMapping(csvHeaders, headers);
      for (const h of headers) {
        if (!mapping[h]) mapping[h] = fuzzy[h] || null;
      }

      const today = new Date().toLocaleDateString('en-GB');
      let imported = 0, skipped = 0;
      const errors = [];
      const rowsToImport = [];

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const row = Array.from({ length: headers.length }, () => '');

        headers.forEach((header, idx) => {
          const csvCol = mapping[header];
          if (csvCol && rec[csvCol] !== undefined) {
            row[idx] = String(rec[csvCol] || '').trim();
          } else if (rec[header] !== undefined) {
            row[idx] = String(rec[header] || '').trim();
          }
        });

        if (row.every(v => !v)) {
          skipped++;
          errors.push(`Row ${i + 2}: Empty row`);
          continue;
        }

        // Metadata (only fills if the column exists and is currently empty)
        const addedByIdx = this.resolveHeaderIndex(headers, ['Added By', 'Modified By', 'AddedBy']);
        if (addedByIdx >= 0 && !row[addedByIdx]) row[addedByIdx] = added_by || 'Bulk Import';
        const updatedIdx = this.resolveHeaderIndex(headers, ['Last Updated', 'Updated At', 'UpdatedAt']);
        if (updatedIdx >= 0 && !row[updatedIdx]) row[updatedIdx] = new Date().toISOString();

        rowsToImport.push(row);
        imported++;
      }

      if (rowsToImport.length > 0) {
        await sheetsAPI.appendRows(`${sheet}!A:ZZ`, rowsToImport);
        const gsId = await this.getSpreadsheetIdForTab(sheet);
        if (gsId) this.syncSpreadsheet(gsId).catch(() => {});
      }

      cache.invalidateSheetData();
      await this.logActivity({ action: 'Bulk Import', actor: added_by, details: `Imported ${imported} rows to ${sheet}` });
      return { success: true, imported, skipped, errors: errors.slice(0, 10) };
    } catch (e) {
      console.error('Bulk import error:', e);
      return { success: false, message: 'Import failed due to a system error.' };
    }
  }

  // Fuzzy mapping: for each sheet header find the closest CSV header by normalised string similarity
  _buildFuzzyMapping(csvHeaders, sheetHeaders) {
    const normalize = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normCsv = csvHeaders.map(h => ({ original: h, norm: normalize(h) }));
    const mapping = {};
    for (const sh of sheetHeaders) {
      const normSh = normalize(sh);
      let match = normCsv.find(c => c.norm === normSh);
      if (!match) match = normCsv.find(c => c.norm.includes(normSh) || normSh.includes(c.norm));
      if (match) mapping[sh] = match.original;
    }
    return mapping;
  }

  // Dynamic AI mapping: maps CSV columns to the TARGET sheet's actual headers
  async _getSmartMappingDynamic(csvHeaders, sheetHeaders, samples) {
    try {
      const model = new ChatMistralAI({
        apiKey: process.env.MISTRAL_API_KEY,
        modelName: 'mistral-small-latest',
        temperature: 0,
      });

      const schemaFields = {};
      sheetHeaders.forEach(h => {
        schemaFields[h] = zod.string().describe(`Best matching CSV column for sheet column "${h}". Empty string if no match.`);
      });
      const parser = StructuredOutputParser.fromZodSchema(zod.object(schemaFields));
      const formatInstructions = parser.getFormatInstructions();

      const prompt = new PromptTemplate({
        template: `You are a data mapping specialist. Map each spreadsheet column to the most appropriate CSV column.
{format_instructions}

Spreadsheet columns (return these as keys): {sheet_headers}
Available CSV columns: {csv_headers}
Sample CSV data: {samples}

Return the matching CSV column name for each spreadsheet column, or empty string if no suitable match exists.`,
        inputVariables: ['sheet_headers', 'csv_headers', 'samples'],
        partialVariables: { format_instructions: formatInstructions },
      });

      const input = await prompt.format({
        sheet_headers: sheetHeaders.join(', '),
        csv_headers: csvHeaders.join(', '),
        samples: JSON.stringify(samples),
      });

      const response = await model.invoke(input);
      return await parser.parse(response.content);
    } catch (err) {
      console.warn('[Smart Mapping] LLM failed, using fuzzy fallback:', err.message);
      return {};
    }
  }

  async validateCSVImport(records, mapping, sheetName, user) {
    // mapping is { sheetHeader: csvColumn } — fully dynamic, no hardcoded schema
    const errors = [];
    let validCount = 0;
    try {
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        // A row is invalid only if every mapped column is empty
        const hasValue = Object.values(mapping).some(csvCol => csvCol && String(rec[csvCol] || '').trim());
        if (!hasValue) {
          errors.push({ row: i + 2, reason: 'Row has no values for any mapped column', data: rec });
        } else {
          validCount++;
        }
      }
      return { success: true, validCount, errorCount: errors.length, errors };
    } catch (e) {
      console.error('CSV Validate Error:', e);
      return { success: false, message: e.message };
    }
  }

  async processCSVImport(records, mapping, sheetName, user) {
    try {
      if (!sheetName) throw new Error("Target sheet is required");

      const validation = await this.validateCSVImport(records, mapping, sheetName, user);
      if (!validation.success) return validation;

      const { errors, validCount } = validation;
      const invalidRows = new Set(errors.map(e => e.row));
      const validRecords = records.filter((_, i) => !invalidRows.has(i + 2));

      if (validRecords.length === 0) {
        return { success: false, message: "No valid rows to import", errors };
      }

      // Get or create the sheet using CSV headers if it's new
      const csvHeaders = Object.keys(records[0] || {});
      let rows = await sheetsAPI.getSheetDataFull(sheetName);
      if (!rows.length || !rows[0]?.length) {
        await sheetsAPI.ensureSheetExists(sheetName, csvHeaders);
        rows = await sheetsAPI.getSheetDataFull(sheetName);
      }
      if (!rows.length) throw new Error('Target sheet not found or empty');
      const headers = rows[0];

      // mapping is { sheetHeader: csvColumn } — write values directly
      let imported = 0;
      const today = new Date().toLocaleDateString('en-GB');

      const BATCH_SIZE = 100;
      for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
        const batch = validRecords.slice(i, i + BATCH_SIZE);
        const rowsToAppend = [];

        const currentData = await sheetsAPI.getSheetDataFull(sheetName);
        const srIdx = this.resolveHeaderIndex(headers, ['Sr.', 'Sr', 'Sr No', 'Sr. No']);
        let lastSr = currentData.length > 1 && srIdx >= 0 ? parseInt(currentData[currentData.length - 1][srIdx]) || 0 : 0;

        for (const rec of batch) {
          const row = Array.from({ length: headers.length }, () => '');
          if (srIdx >= 0) row[srIdx] = ++lastSr;

          headers.forEach((header, idx) => {
            const csvCol = mapping[header];
            if (csvCol && rec[csvCol] !== undefined) {
              row[idx] = String(rec[csvCol] || '').trim();
            }
          });

          // Metadata
          this.setIfHeaderExists(row, headers, ['Added By', 'Modified By', 'AddedBy', 'ModifiedBy'], user?.login_id || 'CSV Import');
          this.setIfHeaderExists(row, headers, ['Last Updated', 'Updated At'], new Date().toISOString());
          this.setIfHeaderExists(row, headers, ['Since'], today);

          rowsToAppend.push(row);
          imported++;
        }

        await sheetsAPI.appendRows(`${sheetName}!A:ZZ`, rowsToAppend);
      }

      // Refresh the Postgres cache for this spreadsheet in the background
      if (imported > 0) {
        const gsId = await this.getSpreadsheetIdForTab(sheetName);
        if (gsId) this.syncSpreadsheet(gsId).catch(() => {});
      }

      cache.invalidateSheetData();
      await this.logActivity({
        action: 'CSV Import',
        actor: user?.login_id,
        details: `Imported ${imported} rows to ${sheetName} (${errors.length} skipped)`
      });

      return { success: true, imported, failed: 0, skipped: errors.length, errors };
    } catch (e) {
      console.error("CSV Process Error:", e);
      return { success: false, message: e.message };
    }
  }

  // ── Sheet Access Grants ──
  async ensureGrantsSheet() {
    await sheetsAPI.ensureSheetExists('sheet_access_grants', [
      'sheet_id', 'user_id', 'granted_by', 'granted_at'
    ]);
  }

  async getUserGrants(user_id) {
    try {
      await this.ensureGrantsSheet();
      const rows = await sheetsAPI.getSheetData('sheet_access_grants!A:D');
      const grants = sheetsAPI.rowsToObjects(rows);
      return grants.filter(g => (g.user_id || g['user id']) === user_id);
    } catch (e) {
      return [];
    }
  }

  // prismaId = Postgres UUID (Spreadsheet.id)
  async getGrantsForSheet(prismaId) {
    try {
      const ss = await prisma.spreadsheet.findUnique({ where: { id: prismaId } });
      if (!ss) return [];
      const grants = await prisma.userTabAccess.findMany({
        where: { spreadsheet_id: ss.id },
        include: { user: { select: { login_id: true, identifier: true, name: true, role: true } } },
      });
      return grants.map(g => ({
        user_id: g.user_id,
        tab_name: g.tab_name,
        granted_by: g.granted_by,
        granted_at: g.granted_at,
        identifier: g.user?.identifier,
        name: g.user?.name,
        role: g.user?.role,
      }));
    } catch (e) {
      console.error('getGrantsForSheet error:', e.message);
      return [];
    }
  }

  // prismaId = Postgres UUID (Spreadsheet.id)
  async updateGrantsForSheet(prismaId, user_ids, granted_by) {
    try {
      const ss = await prisma.spreadsheet.findUnique({
        where: { id: prismaId },
        include: { tabs: true },
      });
      if (!ss) return { success: false, message: 'Spreadsheet not found' };

      // Delete all existing grants for this spreadsheet then re-create
      await prisma.userTabAccess.deleteMany({ where: { spreadsheet_id: ss.id } });

      for (const uid of user_ids) {
        for (const tab of ss.tabs) {
          await prisma.userTabAccess.upsert({
            where: { user_id_spreadsheet_id_tab_name: { user_id: uid, spreadsheet_id: ss.id, tab_name: tab.tab_name } },
            update: { granted_by },
            create: { user_id: uid, spreadsheet_id: ss.id, tab_name: tab.tab_name, granted_by },
          });
        }
      }

      // Bust per-user sheet-names cache so they see changes on next request
      cache.invalidate(/^sheet-names-/);
      await this.logActivity({ action: 'UPDATE_GRANTS', actor: granted_by, details: `Updated grants for ${ss.sheet_id}: ${user_ids.join(', ')}` });
      return { success: true };
    } catch (err) {
      console.error('updateGrantsForSheet error:', err);
      return { success: false, message: err.message };
    }
  }

  // Helper to auto-register primary sheets if they aren't registered
  async autoRegisterPrimarySheets() {
    try {
      const spreadsheetId = process.env.SPREADSHEET_ID;
      if (!spreadsheetId) return;

      const sheetNames = await sheetsAPI.getSheetNames(spreadsheetId);
      
      // 1. Ensure Spreadsheet record exists
      let ss = await prisma.spreadsheet.findUnique({
        where: { sheet_id: spreadsheetId },
        include: { tabs: true }
      });

      if (!ss) {
        console.log(`Creating primary spreadsheet record: ${spreadsheetId}`);
        const title = await sheetsAPI.getSpreadsheetTitle(spreadsheetId);
        ss = await prisma.spreadsheet.create({
          data: {
            sheet_id: spreadsheetId,
            name: title,
            owner_id: 'system'
          },
          include: { tabs: true }
        });
      }

      // 2. Register missing tabs
      for (const name of sheetNames) {
        if (EXCLUDED_SHEETS.has(name.toLowerCase())) continue;
        
        const tabExists = ss.tabs.find(t => t.tab_name === name);
        if (!tabExists) {
          console.log(`Auto-registering primary sheet tab: ${name}`);
          await prisma.spreadsheetTab.create({
            data: {
              spreadsheet_id: ss.id,
              tab_name: name
            }
          });
        }
      }
    } catch (e) {
      console.error('autoRegisterPrimarySheets error:', e.message);
    }
  }


  calculateAge(dob) {
    if (!dob) return 0;
    const parts = dob.split('-');
    if (parts.length < 3) return 0;
    const [d, m, y] = parts.map(Number);
    const ageDate = new Date(Date.now() - new Date(y, m - 1, d).getTime());
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  }
}

const db = new ProductionDatabase();
export default db;
