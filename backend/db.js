import * as sheetsAPI from './googleSheetsService.js';
import { v4 as uuidv4 } from 'uuid';
import { sendWelcomeEmail } from './emailService.js';
import { hashPassword, comparePassword } from './auth.js';
import cache from './cache.js';
import { ChatMistralAI } from '@langchain/mistralai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z as zod } from 'zod';

const FALLBACK_SHEETS = ['Japa', 'Elderly Care', 'Patient Care', 'Newborn Baby Care', 'Cook', 'Driver', 'Maid / Housekeeping'];
const EXCLUDED_SHEETS = new Set(['users', 'activitylog', 'activity_logs', 'activity logs', 'config', 'spreadsheetregistry', 'spreadsheet_registry', 'google_sheets', 'sheet_access_grants']);

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
    const cacheKey = (nr === 'super_admin' || nr === 'admin') ? 'sheet-names-admin' : `sheet-names-${user?.login_id || 'anon'}`;
    return cache.getOrFetch(cacheKey, async () => {
      try {
        const allSheets = await this._getAllSheetsFromRegistry();
        const candidateSheets = allSheets.filter((s) => !EXCLUDED_SHEETS.has(String(s.name).toLowerCase()));
        
        // If super_admin or admin, they see everything
        if (nr === 'super_admin' || nr === 'admin') {
          return candidateSheets.map(s => s.name);
        }

        // Users only see explicitly granted sheets from sheet_access_grants
        if (user && nr === 'user') {
          const grants = await this.getUserGrants(user.login_id);
          const grantedSheetIds = grants.map(g => g.sheet_id);
          return candidateSheets
            .filter(s => grantedSheetIds.includes(s.id))
            .map(s => s.name);
        }
        
        return [];
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
    
    // Admins and Super Admins see everything
    if (nr === 'super_admin' || nr === 'admin') {
      if (sheet && sheet !== 'all') return [sheet];
      return this.getCandidateSheets(user);
    }

    // Standard Users
    if (sheet && sheet !== 'all') {
      const grants = await this.getUserGrants(user?.login_id);
      const allSheets = await this._getAllSheetsFromRegistry();
      const grantedSheetIds = grants.map(g => g.sheet_id || g['sheet id']);
      
      // Check if target sheet name matches any granted sheet ID from registry
      const targetSheet = allSheets.find(s => s.name === sheet && grantedSheetIds.includes(s.id));
      if (!targetSheet) return [];
      return [sheet];
    }

    // Default: return all sheets this user is granted
    return this.getCandidateSheets(user);
  }

  normalizeCandidate(raw = {}, fallbackSheet = '') {
    const get = (...keys) => {
      for (const key of keys) {
        if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
      }
      return '';
    };
    return {
      sr_no: Number(get('sr', 'sr_', 'sr_no', 'sr._no', 'sr._')) || 0,
      name: get('name'),
      address: get('address'),
      state: get('state'),
      marital_status: get('marital_status'),
      timing: get('timing'),
      area: get('area'),
      experience: get('experience'),
      education: get('education'),
      dob: get('dob'),
      age: get('age'),
      gender: get('gender'),
      salary: Number(get('salary')) || 0,
      mobile: String(get('mobile_no', 'mobile')),
      verification: String(get('verification', 'status') || 'not verified').toLowerCase(),
      description: get('description'),
      since: get('since'),
      added_by: get('added_by', 'addedby'),
      updated_by: get('updated_by', 'updatedby'),
      last_updated: get('last_updated', 'lastupdated', 'updatedon'),
      last_message: get('last_message', 'lastmessage', 'notes'),
      sheet: get('_sheet') || fallbackSheet,
      _sheet: get('_sheet') || fallbackSheet,
    };
  }

  /** Cached sheet data fetch - the key performance fix */
  async getCachedSheetData(sheetName) {
    const cacheKey = `sheet:${sheetName}`;
    return cache.getOrFetch(cacheKey, async () => {
      // Check if it's a dynamic spreadsheet
      const spreadsheets = await this.getRegisteredSpreadsheets();
      const dynamicSheet = spreadsheets.find(ss => ss.name === sheetName);
      if (dynamicSheet) {
        const rows = await this.getSheetDataForSpreadsheet(dynamicSheet.sheet_id);
        return rows.map((row) => this.normalizeCandidate(row, sheetName));
      }

      const rows = await sheetsAPI.getSheetData(`${sheetName}!A:Z`);
      return sheetsAPI.rowsToObjects(rows).map((row) => this.normalizeCandidate(row, sheetName));
    }, 2 * 60 * 1000); // 2 minutes for direct sheets
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
      let rows = await sheetsAPI.getSheetData('Users!A:K');
      if (!rows || rows.length < 2) {
        console.warn('[Login] Users sheet is empty. Auto-seeding default super_admin...');
        const defaultAdmin = [
          'admin_root',
          'admin@staffurs.com',
          await hashPassword('admin123'),
          'super_admin',
          'active',
          'Initial system account',
          'All',
          new Date().toISOString(),
          'System',
          '100'
        ];
        await sheetsAPI.ensureSheetExists('Users', ['Login ID','Identifier','Password','Role','Status','Notes','Sheet Access','Created At','Created By','Max Users']);
        await sheetsAPI.appendRow('Users!A:J', defaultAdmin);
        // Refresh rows after seeding
        rows = await sheetsAPI.getSheetData('Users!A:K');
      }

      let users = sheetsAPI.rowsToObjects(rows);
      console.log(`[Login] Found ${users.length} valid user records in sheet.`);

      if (users.length === 0) {
        console.warn('[Login] No valid users found. Auto-seeding default super_admin...');
        const defaultAdmin = [
          'admin_root',
          'admin@staffurs.com',
          await hashPassword('admin123'),
          'super_admin',
          'active',
          'Initial system account',
          'All',
          new Date().toISOString(),
          'System',
          '100'
        ];
        await sheetsAPI.ensureSheetExists('Users', ['Login ID','Identifier','Password','Role','Status','Notes','Sheet Access','Created At','Created By','Max Users']);
        await sheetsAPI.appendRow('Users!A:J', defaultAdmin);
        // Refresh rows after seeding
        rows = await sheetsAPI.getSheetData('Users!A:K');
        users = sheetsAPI.rowsToObjects(rows);
        console.log(`[Login] Successfully seeded and reloaded ${users.length} users.`);
      }

      let user = users.find(u => u.email === identifier || u.identifier === identifier || u.login_id === identifier);
      
      if (!user) {
        console.warn(`[Login] No user found matching identifier: ${identifier}`);
        const available = users.slice(0, 3).map(u => u.identifier || u.email || u.login_id);
        console.log(`[Login] Available identifiers (sample): ${available.join(', ')}`);
        return { success: false, message: 'Invalid credentials' };
      }

      let isMatch = false;
      if (user.password?.startsWith('$2')) {
        isMatch = await comparePassword(password, user.password);
      } else {
        isMatch = (password === user.password || password === user.pass);
      }

      if (isMatch) {
        console.log(`[Login] Success for user: ${user.identifier || user.email || user.login_id}`);
        
        // Fail-safe: Force super_admin for the root account
        let role = this.normalizeRole(user.role);
        if (user.login_id === 'admin_root' || user.identifier === 'admin@staffurs.com' || user.email === 'admin@staffurs.com') {
          role = 'super_admin';
        }

        return {
          success: true,
          user: {
            login_id: user.login_id || user['login id'] || '',
            identifier: user.email || user.identifier || '',
            role,
            display_role: this.displayRole(role),
            sheet_access: this.safeParseAccess(user.sheet_access),
            created_by: user.created_by || user['created by'] || '',
            max_user_quota: parseInt(user.max_users || user['max users'] || 10),
          }
        };
      } else {
        console.warn(`[Login] Password mismatch for user: ${identifier}`);
        return { success: false, message: 'Invalid credentials' };
      }
    } catch (err) {
      console.error('Login Error:', err);
      return { success: false, message: 'Database connection failed' };
    }
  }

  safeParseAccess(access) {
    if (!access) return [];
    if (access.toLowerCase() === 'all') return ['All'];
    try { return JSON.parse(access); } catch { return access.split(',').map(s => s.trim()); }
  }

  async grantAccess(data) {
    const newLoginId = 'staffurs_' + Math.random().toString(36).slice(2, 8);
    const tempPassword = Math.random().toString(36).slice(-8);
    try {
      const hashedPassword = await hashPassword(tempPassword);
      const normalizedRole = this.normalizeRole(data.role || 'user');
      // Columns: Login ID | Identifier | Password | Role | Status | Notes | Sheet Access | Created At | Created By | Max Users
      const row = [
        newLoginId,
        data.identifier,
        hashedPassword,
        normalizedRole,
        'active',
        data.notes || '',
        JSON.stringify(data.sheet_access || []),
        new Date().toISOString(),
        data.created_by || data.added_by || '',
        normalizedRole === 'admin' ? String(parseInt(data.max_users) || 10) : '',
      ];
      await sheetsAPI.ensureSheetExists('Users', ['Login ID','Identifier','Password','Role','Status','Notes','Sheet Access','Created At','Created By','Max Users']);
      await sheetsAPI.appendRow('Users!A:J', row);
      const emailSent = await sendWelcomeEmail(data.identifier, newLoginId, tempPassword);
      await this.logActivity({ action: 'Granted Access', user: data.created_by || 'Admin', details: `Created ${normalizedRole} account for ${data.identifier}` });
      return { success: true, login_id: newLoginId, password: tempPassword, message: emailSent ? 'Access granted and welcome email sent.' : 'Access granted but email failed to send.' };
    } catch (err) {
      console.error('Grant Access Error:', err);
      return { success: false, message: 'Could not grant access. Ensure "Users" sheet exists.' };
    }
  }

  // getUsers: if created_by is provided, filter to only that admin's users (admin scope)
  async getUsers(created_by = null) {
    const rows = await sheetsAPI.getSheetData('Users!A:J');
    let users = sheetsAPI.rowsToObjects(rows);
    if (created_by) {
      users = users.filter(u => (u.created_by || u['created by'] || '') === created_by);
    }
    return {
      users: users.map(u => {
        const rawRole = u.role || 'user';
        return {
          login_id: u.login_id || u['login id'] || '',
          identifier: u.email || u.identifier || u.phone || '',
          role: this.normalizeRole(rawRole),
          display_role: this.displayRole(rawRole),
          status: u.status || 'active',
          sheet_access: this.safeParseAccess(u.sheet_access || u['sheet access'] || '[]'),
          max_user_quota: parseInt(u.max_users || u['max users'] || 10),
          created_by: u.created_by || u['created by'] || '',
          created_at: u.created_at || u['created at'] || '',
        };
      }).filter(u => u.status !== 'inactive')
    };
  }

  // Check if a user belongs to an admin (for scoped operations)
  async checkUserOwnership(admin_login_id, target_login_id) {
    const rows = await sheetsAPI.getSheetData('Users!A:J');
    const users = sheetsAPI.rowsToObjects(rows);
    const target = users.find(u => (u.login_id || u['login id'] || '') === target_login_id);
    if (!target) return false;
    return (target.created_by || target['created by'] || '') === admin_login_id;
  }

  // Get single user by login_id
  async getUserById(login_id) {
    const rows = await sheetsAPI.getSheetData('Users!A:J');
    const users = sheetsAPI.rowsToObjects(rows);
    const u = users.find(u => (u.login_id || u['login id'] || '') === login_id);
    if (!u) return null;
    return { login_id: u.login_id, role: this.normalizeRole(u.role), identifier: u.identifier || u.email };
  }

  // Check quota for an admin before creating a new user
  async checkAdminQuota(admin_login_id) {
    const usersResult = await this.getUsers(admin_login_id);
    const adminRecord = await this.getUserById(admin_login_id);
    const rows = await sheetsAPI.getSheetData('Users!A:J');
    const users = sheetsAPI.rowsToObjects(rows);
    const adminRow = users.find(u => (u.login_id || u['login id']) === admin_login_id);
    const max = parseInt(adminRow?.max_users || adminRow?.['max users'] || 10);
    const used = usersResult.users.length;
    return { canCreate: used < max, used, max };
  }

  // Super admin global dashboard: all admins + quota usage
  async getAdminDashboard() {
    const rows = await sheetsAPI.getSheetData('Users!A:J');
    const users = sheetsAPI.rowsToObjects(rows).filter(u => u.status !== 'inactive');
    const allUsers = await this.getUsers(); // all users
    const admins = users.filter(u => this.normalizeRole(u.role) === 'admin');
    return {
      total_users: users.filter(u => this.normalizeRole(u.role) === 'user').length,
      total_admins: admins.length,
      admins: admins.map(a => {
        const adminLoginId = a.login_id || a['login id'] || '';
        const theirUsers = allUsers.users.filter(u => u.created_by === adminLoginId);
        const max = parseInt(a.max_users || a['max users'] || 10);
        return {
          login_id: adminLoginId,
          identifier: a.identifier || a.email || '',
          display_role: 'Admin',
          max_user_quota: max,
          used_quota: theirUsers.length,
          quota_pct: Math.round((theirUsers.length / max) * 100),
          created_at: a.created_at || a['created at'] || '',
        };
      }),
    };
  }

  // ── Candidates (CACHED) ──
  async getSheetData(sheet, page = 1, limit = 50, user) {
    try {
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
    const cacheKey = (nr === 'admin' || nr === 'super_admin') ? 'sheet-summary-admin' : `sheet-summary-${user?.login_id || 'anon'}`;
    
    return cache.getOrFetch(cacheKey, async () => {
      // 1. Get registry of all spreadsheets (Already cached metadata)
      const allRegistered = await this.getRegisteredSpreadsheets();
      
      // 2. Filter by user access
      let visibleSheets = [];
      if (nr === 'super_admin' || nr === 'admin') {
        visibleSheets = allRegistered.filter(s => s.is_active);
      } else if (user) {
        const grants = await this.getUserGrants(user.login_id);
        const grantedIds = grants.map(g => g.sheet_id);
        visibleSheets = allRegistered.filter(s => s.is_active && grantedIds.includes(s.sheet_id));
      }

      const sheets = visibleSheets.map(s => ({
        name: s.tab_name,
        count: s.candidate_count || 0,
        verified: s.verified_count || 0
      }));

      const grandTotal = sheets.reduce((acc, s) => acc + s.count, 0);
      const grandVerified = sheets.reduce((acc, s) => acc + s.verified, 0);

      return { 
        sheets, 
        added_this_month: 0, 
        total: grandTotal, 
        total_verified: grandVerified 
      };
    }, 10 * 60 * 1000);
  }

  async addCandidate(sheet, candidate, added_by) {
    try {
      const rows = await sheetsAPI.getSheetData(`${sheet}!A:U`);
      if (!rows.length) return { success: false, message: 'Sheet is empty or missing headers' };
      const headers = rows[0];
      const srIdx = this.resolveHeaderIndex(headers, ['Sr.', 'Sr', 'Sr No', 'Sr. No']);
      const lastSrNo = rows.length > 1 && srIdx >= 0 ? parseInt(rows[rows.length - 1][srIdx]) || 0 : 0;
      const sr_no = lastSrNo + 1;
      const row = Array.from({ length: headers.length }, () => '');
      const today = new Date().toLocaleDateString('en-GB');
      this.setIfHeaderExists(row, headers, ['Name'], candidate.name || '');
      this.setIfHeaderExists(row, headers, ['Address'], candidate.address || '');
      this.setIfHeaderExists(row, headers, ['State'], candidate.state || '');
      this.setIfHeaderExists(row, headers, ['Marital status', 'Marital Status'], candidate.marital_status || '');
      this.setIfHeaderExists(row, headers, ['Timing'], candidate.timing || '');
      this.setIfHeaderExists(row, headers, ['Area'], candidate.area || '');
      this.setIfHeaderExists(row, headers, ['experience', 'Experience'], candidate.experience || '');
      this.setIfHeaderExists(row, headers, ['Education'], candidate.education || '');
      this.setIfHeaderExists(row, headers, ['DOB'], candidate.dob || '');
      this.setIfHeaderExists(row, headers, ['Age'], this.calculateAge(candidate.dob));
      this.setIfHeaderExists(row, headers, ['Gender'], candidate.gender || '');
      this.setIfHeaderExists(row, headers, ['Salary'], candidate.salary || 0);
      this.setIfHeaderExists(row, headers, ['Mobile No', 'Mobile'], candidate.mobile || '');
      this.setIfHeaderExists(row, headers, ['Verification'], candidate.verification || 'pending');
      this.setIfHeaderExists(row, headers, ['Description'], candidate.description || '');
      this.setIfHeaderExists(row, headers, ['Since'], candidate.since || today);
      this.setIfHeaderExists(row, headers, ['Sr.', 'Sr', 'Sr No', 'Sr. No'], sr_no);
      this.setIfHeaderExists(row, headers, ['Added By', 'Updated By', 'Modified By'], added_by || 'System');
      this.setIfHeaderExists(row, headers, ['Last Updated', 'Updated At'], new Date().toISOString());
      if (candidate.last_message) {
        let snippet = candidate.last_message;
        if (snippet.length > 200) snippet = snippet.substring(0, 197) + '...';
        this.setIfHeaderExists(row, headers, ['Last Message', 'Lastmessage', 'Notes'], snippet);
      }
      this.setIfHeaderExists(row, headers, ['_sheet'], sheet);
      await sheetsAPI.appendRow(`${sheet}!A:U`, row);
      cache.invalidateSheetData();
      return { success: true, sr_no };
    } catch (err) {
      console.error('Add Candidate Error:', err);
      return { success: false, message: 'Could not add candidate. Ensure sheet exists.' };
    }
  }

  async logActivity({ action, user, details }) {
    try {
      const headers = ['Action', 'User', 'Details', 'Timestamp'];
      await sheetsAPI.ensureSheetExists('ActivityLog', headers);
      const row = [action, user, details, new Date().toISOString()];
      await sheetsAPI.appendRow('ActivityLog!A:D', row);
    } catch (err) {
      console.error('Log Activity Error:', err);
    }
  }

  async getActivityLog(page = 1, limit = 50) {
    const rows = await sheetsAPI.getSheetData('ActivityLog!A:D');
    const allLogs = sheetsAPI.rowsToObjects(rows);
    const total = allLogs.length;
    const start = (page - 1) * limit;
    return { total, logs: allLogs.slice(start, start + limit).reverse() };
  }

  // ── Smart Search with fuzzy matching ──
  smartSearch(allData, query) {
    if (!query || !query.trim()) return allData;
    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);

    // Score each candidate
    const scored = allData.map(item => {
      let score = 0;
      const searchableText = [
        item.name, item.address, item.state, item.area,
        item.experience, item.education, item.description,
        item.mobile, item.gender, item.timing, item.marital_status,
        item.verification, item.sheet, item._sheet
      ].map(v => String(v || '').toLowerCase()).join(' ');

      // Exact full query match in any field = highest score
      if (searchableText.includes(q)) score += 100;

      // Per-token matching
      for (const token of tokens) {
        if (searchableText.includes(token)) {
          score += 10;
          // Bonus for name match
          if (String(item.name || '').toLowerCase().includes(token)) score += 20;
          // Bonus for area match
          if (String(item.area || '').toLowerCase().includes(token)) score += 15;
          // Bonus for description match
          if (String(item.description || '').toLowerCase().includes(token)) score += 5;
        } else {
          // Fuzzy: check if token is close to any word (1-char difference)
          const words = searchableText.split(/\s+/);
          for (const word of words) {
            if (word.length > 2 && token.length > 2 && this.fuzzyMatch(token, word)) {
              score += 3;
              break;
            }
          }
        }
      }

      // Intent detection: age ranges
      const ageMatch = q.match(/(\d+)\s*[-–to]+\s*(\d+)\s*(year|yr|age)/i);
      if (ageMatch) {
        const minAge = parseInt(ageMatch[1]);
        const maxAge = parseInt(ageMatch[2]);
        const age = parseInt(item.age) || 0;
        if (age >= minAge && age <= maxAge) score += 30;
      }

      // Intent: salary range  
      const salaryMatch = q.match(/(\d+)\s*k?\s*[-–to]+\s*(\d+)\s*k?\s*(salary|pay|rupee|₹)?/i);
      if (salaryMatch) {
        let minSal = parseInt(salaryMatch[1]);
        let maxSal = parseInt(salaryMatch[2]);
        if (minSal < 1000) minSal *= 1000;
        if (maxSal < 1000) maxSal *= 1000;
        const sal = parseInt(item.salary) || 0;
        if (sal >= minSal && sal <= maxSal) score += 30;
      }

      // Intent: experience
      const expMatch = q.match(/(\d+)\+?\s*(year|yr|exp)/i);
      if (expMatch) {
        const years = parseInt(expMatch[1]);
        const exp = String(item.experience || '').toLowerCase();
        if (exp.includes(`${years}`) || exp.includes('10+') && years <= 10) score += 20;
      }

      return { ...item, _score: score };
    });

    return scored
      .filter(item => item._score > 0)
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

  // ── Search & Filters (CACHED + SMART) ──
  async applyFilters(sheet, filters, page = 1, limit = 50, user) {
    try {
      let allData = await this.getAllCandidateData(sheet, user);

      // Smart search
      if (filters.search) {
        allData = this.smartSearch(allData, filters.search);
      }

      // Structural filters
      if (filters.gender?.length) {
        const n = filters.gender.map(g => String(g).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.gender || '').toLowerCase()));
      }
      if (filters.state?.length) {
        const n = filters.state.map(s => String(s).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.state || '').toLowerCase()));
      }
      if (filters.verification?.length) {
        const n = filters.verification.map(v => String(v).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.verification || '').toLowerCase()));
      }
      if (filters.experience?.length) {
        const n = filters.experience.map(v => String(v).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.experience || '').toLowerCase()));
      }
      if (filters.education?.length) {
        const n = filters.education.map(v => String(v).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.education || '').toLowerCase()));
      }
      if (filters.timing?.length) {
        const n = filters.timing.map(v => String(v).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.timing || '').toLowerCase()));
      }
      if (filters.marital_status?.length) {
        const n = filters.marital_status.map(v => String(v).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.marital_status || '').toLowerCase()));
      }
      if (filters.area?.length) {
        const n = filters.area.map(v => String(v).toLowerCase());
        allData = allData.filter(item => n.includes(String(item.area || '').toLowerCase()));
      }
      if (filters.salary_min) {
        allData = allData.filter(item => parseInt(item.salary || 0) >= parseInt(filters.salary_min));
      }
      if (filters.salary_max) {
        allData = allData.filter(item => parseInt(item.salary || 0) <= parseInt(filters.salary_max));
      }

      const total = allData.length;
      const start = (page - 1) * limit;
      return { total, page, data: allData.slice(start, start + limit) };
    } catch (err) {
      console.error('Apply Filters Error:', err);
      return { total: 0, page: 1, data: [] };
    }
  }

  async getFilterOptions(sheet, user) {
    const cacheKey = `filter-opts:${sheet || 'all'}-${user?.login_id || 'anon'}`;
    return cache.getOrFetch(cacheKey, async () => {
      try {
        const allData = await this.getAllCandidateData(sheet, user);
        const sets = { state: new Set(), gender: new Set(), education: new Set(), experience: new Set(), marital_status: new Set(), verification: new Set(), timing: new Set(), area: new Set() };
        for (const item of allData) {
          if (item.state) sets.state.add(item.state);
          if (item.gender) sets.gender.add(item.gender);
          if (item.education) sets.education.add(item.education);
          if (item.experience) sets.experience.add(item.experience);
          if (item.marital_status) sets.marital_status.add(item.marital_status);
          if (item.verification) sets.verification.add(item.verification);
          if (item.timing) sets.timing.add(item.timing);
          if (item.area) sets.area.add(item.area);
        }
        const result = {};
        for (const [k, v] of Object.entries(sets)) result[k] = Array.from(v).sort();
        return result;
      } catch (err) {
        console.error('Get Filter Options Error:', err);
        return { state: [], gender: [], education: [], experience: [], marital_status: [], verification: [], timing: [], area: [] };
      }
    }, 5 * 60 * 1000);
  }

  async editCandidate(sr_no, sheet, target_sheet, updated_fields, updated_by) {
    try {
      const rows = await sheetsAPI.getSheetData(`${sheet}!A:U`);
      if (!rows.length) return { success: false, message: 'Sheet is empty' };
      const originalHeaders = rows[0];
      const headers = rows[0].map((h) => String(h).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));

      // Find the row - try sr_no first, then fallback to name+mobile match
      let rowIndex = -1;
      if (sr_no && sr_no !== 0) {
        rowIndex = await sheetsAPI.findRowIndexByAliases(sheet, ['Sr.', 'Sr', 'Sr. No', 'Sr No'], String(sr_no));
      }
      // Fallback: match by name + mobile (more reliable than sr_no)
      if (rowIndex === -1 && updated_fields.name) {
        const nameIdx = this.resolveHeaderIndex(originalHeaders, ['Name']);
        const mobileIdx = this.resolveHeaderIndex(originalHeaders, ['Mobile No', 'Mobile']);
        for (let i = 1; i < rows.length; i++) {
          const nameMatch = nameIdx >= 0 && String(rows[i][nameIdx] || '').toLowerCase() === String(updated_fields.name || '').toLowerCase();
          const mobileMatch = mobileIdx >= 0 && String(rows[i][mobileIdx] || '') === String(updated_fields.mobile || '');
          if (nameMatch && (mobileMatch || mobileIdx === -1)) { rowIndex = i; break; }
        }
      }
      if (rowIndex === -1) return { success: false, message: 'Candidate not found' };

      // Ensure existingRow is at least as long as originalHeaders, filling missing with empty string
      const existingRow = Array.from({ length: originalHeaders.length }, (_, i) => rows[rowIndex][i] !== undefined ? rows[rowIndex][i] : '');

      // Map field names to header indices
      const fieldMap = {
        name: ['Name'], address: ['Address'], state: ['State'],
        marital_status: ['Marital status', 'Marital Status'], timing: ['Timing'],
        area: ['Area'], experience: ['experience', 'Experience'],
        education: ['Education'], dob: ['DOB'], age: ['Age'],
        gender: ['Gender'], salary: ['Salary'],
        mobile: ['Mobile No', 'Mobile'], verification: ['Verification'],
        description: ['Description'], since: ['Since'],
        last_message: ['Last Message', 'Lastmessage', 'Notes'],
      };
      Object.entries(updated_fields).forEach(([key, val]) => {
        const aliases = fieldMap[key];
        if (aliases) this.setIfHeaderExists(existingRow, originalHeaders, aliases, val);
      });
      // Recalculate age from DOB if provided
      if (updated_fields.dob) {
        this.setIfHeaderExists(existingRow, originalHeaders, ['Age'], this.calculateAge(updated_fields.dob));
      }
      this.setIfHeaderExists(existingRow, originalHeaders, ['Updated By', 'Added By', 'Modified By'], updated_by || this.getIfHeaderExists(existingRow, originalHeaders, ['Updated By', 'Added By', 'Modified By']));
      this.setIfHeaderExists(existingRow, originalHeaders, ['Last Updated', 'Updated At'], new Date().toISOString());
      
      if (updated_fields.last_message) {
        let snippet = updated_fields.last_message;
        if (snippet.length > 200) snippet = snippet.substring(0, 197) + '...';
        this.setIfHeaderExists(existingRow, originalHeaders, ['Last Message', 'Lastmessage', 'Notes'], snippet);
      }
      if (target_sheet && target_sheet !== sheet) {
        this.setIfHeaderExists(existingRow, originalHeaders, ['_sheet'], target_sheet);
        console.log(`[editCandidate] Moving candidate from ${sheet} (row ${rowIndex}) to ${target_sheet}. Data:`, existingRow);
        await sheetsAPI.appendRow(`${target_sheet}!A:U`, existingRow);
        await sheetsAPI.deleteRow(sheet, rowIndex); // Delete from original sheet
      } else {
        console.log(`[editCandidate] Updating candidate in ${sheet} at row ${rowIndex}. Data:`, existingRow);
        await sheetsAPI.updateRow(sheet, rowIndex, existingRow);
      }
      cache.invalidateSheetData();
      return { success: true };
    } catch (err) {
      console.error('Edit Candidate Error:', err);
      return { success: false, message: 'Update failed: ' + err.message };
    }
  }

  async removeCandidate(sr_no, sheet, removed_by) {
    try {
      const rowIndex = await sheetsAPI.findRowIndexByAliases(sheet, ['Sr.', 'Sr', 'Sr. No', 'Sr No'], String(sr_no));
      if (rowIndex === -1) return { success: false, message: 'Candidate not found' };
      await sheetsAPI.deleteRow(sheet, rowIndex);
      cache.invalidateSheetData();
      await this.logActivity({ action: 'Removed Candidate', user: removed_by || 'System', details: `Removed candidate Sr. No ${sr_no} from ${sheet}` });
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
    const rowIndex = await sheetsAPI.findRowIndex('Users', 'Login ID', login_id);
    if (rowIndex === -1) return { success: false, message: 'User not found' };
    const rows = await sheetsAPI.getSheetData('Users!A:I');
    const userRow = rows[rowIndex];
    const isMatch = userRow[2].startsWith('$2') ? await comparePassword(old_password, userRow[2]) : old_password === userRow[2];
    if (!isMatch) return { success: false, message: 'Incorrect old password' };
    const hashedPassword = await hashPassword(new_password);
    userRow[2] = hashedPassword;
    await sheetsAPI.updateRow('Users', rowIndex, userRow);
    return { success: true };
  }

  async resetPassword(target_login_id, reset_by) {
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await hashPassword(tempPassword);
    const rowIndex = await sheetsAPI.findRowIndex('Users', 'Login ID', target_login_id);
    if (rowIndex === -1) return { success: false, message: 'User not found' };
    const rows = await sheetsAPI.getSheetData('Users!A:I');
    const userRow = rows[rowIndex];
    userRow[2] = hashedPassword;
    await sheetsAPI.updateRow('Users', rowIndex, userRow);
    return { success: true, tempPassword };
  }

  async removeUser(target_login_id, removed_by) {
    const rowIndex = await sheetsAPI.findRowIndex('Users', 'Login ID', target_login_id);
    if (rowIndex === -1) return { success: false, message: 'User not found' };
    const rows = await sheetsAPI.getSheetData('Users!A:I');
    const userRow = rows[rowIndex];
    userRow[4] = 'inactive';
    await sheetsAPI.updateRow('Users', rowIndex, userRow);
    return { success: true };
  }

  async updateUserRights(data) {
    const rowIndex = await sheetsAPI.findRowIndex('Users', 'Login ID', data.target_login_id);
    if (rowIndex === -1) return { success: false, message: 'User not found' };
    const rows = await sheetsAPI.getSheetData('Users!A:K');
    const userRow = rows[rowIndex];
    userRow[3] = data.role || userRow[3];
    userRow[6] = JSON.stringify(data.sheet_access || []);
    await sheetsAPI.updateRow('Users', rowIndex, userRow);
    cache.invalidateSheetData();
    return { success: true };
  }

  async updateUserLimit(target_login_id, max_users, updated_by) {
    const rowIndex = await sheetsAPI.findRowIndex('Users', 'Login ID', target_login_id);
    if (rowIndex === -1) return { success: false, message: 'User not found' };
    const rows = await sheetsAPI.getSheetData('Users!A:K');
    const userRow = rows[rowIndex];
    userRow[9] = String(parseInt(max_users) || 10);
    await sheetsAPI.updateRow('Users', rowIndex, userRow);
    return { success: true };
  }

  // ── Google Sheets Integration (Dynamic) ──
  async getRegisteredSpreadsheets() {
    try {
      await sheetsAPI.ensureSheetExists('google_sheets', [
        'id', 'sheet_id', 'name', 'description', 'tab_name', 'columns', 
        'last_synced_at', 'sync_interval_minutes', 'is_active', 'created_by', 'created_at',
        'candidate_count', 'verified_count'
      ]);
      const rows = await sheetsAPI.getSheetData('google_sheets!A:M');
      return sheetsAPI.rowsToObjects(rows).map(r => ({
        id: r.id,
        sheet_id: r.sheet_id,
        name: r.name,
        description: r.description,
        tab_name: r.tab_name,
        columns: r.columns ? JSON.parse(r.columns) : [],
        last_synced_at: r.last_synced_at,
        sync_interval_minutes: parseInt(r.sync_interval_minutes || 15),
        is_active: r.is_active === 'true' || r.is_active === true,
        created_by: r.created_by,
        created_at: r.created_at,
        candidate_count: parseInt(r.candidate_count || 0),
        verified_count: parseInt(r.verified_count || 0)
      }));
    } catch (e) {
      console.error('getRegisteredSpreadsheets error:', e.message);
      return [];
    }
  }

  async addSpreadsheet(sheet_id, added_by) {
    try {
      // Fetch metadata from Google API
      const metadata = await sheetsAPI.getSpreadsheetMetadata(sheet_id);
      const title = metadata.properties.title;
      const firstTab = metadata.sheets[0]?.properties?.title;
      
      // Fetch headers of the first tab
      const rows = await sheetsAPI.getSheetData(`${firstTab}!A1:Z1`, sheet_id);
      const headers = rows && rows.length > 0 ? rows[0] : [];
      const columns = headers.map((h, i) => ({ name: String(h).trim(), index: i, type: 'string' }));

      await sheetsAPI.ensureSheetExists('google_sheets', [
        'id', 'sheet_id', 'name', 'description', 'tab_name', 'columns', 
        'last_synced_at', 'sync_interval_minutes', 'is_active', 'created_by', 'created_at',
        'candidate_count', 'verified_count'
      ]);
      
      const newId = uuidv4();
      const row = [
        newId,
        sheet_id,
        title,
        '',
        firstTab,
        JSON.stringify(columns),
        '',
        '15',
        'true',
        added_by || 'System',
        new Date().toISOString(),
        '0', // candidate_count
        '0'  // verified_count
      ];
      
      await sheetsAPI.appendRow('google_sheets!A:M', row);
      cache.invalidateSheetData();
      await this.logActivity({ action: 'Added Google Sheet', user: added_by, details: `Added sheet: ${title} (${sheet_id})` });
      
      return { success: true, title, tabs: metadata.sheets.map(s => s.properties.title), columns };
    } catch (e) {
      return { success: false, message: 'Could not add spreadsheet: ' + e.message };
    }
  }

  async removeSpreadsheet(sheet_id, removed_by) {
    try {
      const rowIndex = await sheetsAPI.findRowIndex('google_sheets', 'sheet_id', sheet_id);
      if (rowIndex === -1) return { success: false, message: 'Spreadsheet not found in database' };
      const rows = await sheetsAPI.getSheetData('google_sheets!A:M');
      const row = rows[rowIndex];
      row[8] = 'false'; // is_active
      await sheetsAPI.updateRow('google_sheets', rowIndex, row);
      cache.invalidateSheetData();
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async syncSpreadsheet(sheet_id) {
    try {
      const rowIndex = await sheetsAPI.findRowIndex('google_sheets', 'sheet_id', sheet_id);
      if (rowIndex === -1) return { success: false, message: 'Spreadsheet not found in database' };
      
      const rows = await sheetsAPI.getSheetData('google_sheets!A:M');
      const row = rows[rowIndex];
      const tab_name = row[4];
      
      // Fetch fresh data from Google API - use quotes for tab names with spaces
      const range = `'${tab_name}'!A:Z`;
      const sheetData = await sheetsAPI.getSheetData(range, sheet_id);
      if (!sheetData || !sheetData.length) {
        return { success: true, message: 'No data to sync', rows: 0 };
      }
      
      const headers = sheetData[0];
      const dataRows = sheetData.slice(1);
      
      // Ensure sheet_data table exists
      await sheetsAPI.ensureSheetExists('sheet_data', ['id', 'sheet_id', 'data_json']);
      
      // Get existing sheet_data to clear old entries for this sheet_id
      // In a real DB we would do a DELETE FROM sheet_data WHERE sheet_id = ?. 
      // In Google Sheets, this is expensive. We'll read all, filter out this sheet_id, append new, and overwrite.
      // Since Google Sheets isn't a great DB for this, we will just clear and append if possible.
      // A better approach for Google Sheets "table": just fetch all and rebuild the sheet.
      const allCacheRows = await sheetsAPI.getSheetData('sheet_data!A:C');
      const retainedRows = allCacheRows.filter((r, i) => i === 0 || r[1] !== sheet_id); // Keep headers and other sheets
      
      const newCacheRows = dataRows.map((dr, drIndex) => {
        const rowObj = {};
        headers.forEach((h, i) => { 
          let normalizedH = String(h || `col_${i + 1}`)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || `col_${i + 1}`;
          
          // Smart mapping for common HRMS aliases
          if (normalizedH === 'sr' || normalizedH === 's_no' || normalizedH === 'serial') normalizedH = 'sr_no';
          if (normalizedH === 'exp' || normalizedH === 'work_exp') normalizedH = 'experience';
          if (normalizedH === 'mobile_no' || normalizedH === 'phone' || normalizedH === 'contact') normalizedH = 'mobile';
          if (normalizedH === 'desc' || normalizedH === 'details') normalizedH = 'description';
          if (normalizedH === 'modified_by' || normalizedH === 'added_by' || normalizedH === 'user') normalizedH = 'added_by';
          if (normalizedH.startsWith('salary')) normalizedH = 'salary';

          rowObj[normalizedH] = dr[i] || ''; 
        });

        // Fallback for sr_no if missing or zero
        if (!rowObj.sr_no || rowObj.sr_no === '0' || rowObj.sr_no === 0) {
          rowObj.sr_no = drIndex + 1;
        }

        return [uuidv4(), sheet_id, JSON.stringify(rowObj)];
      });
      
      const combinedRows = [...retainedRows, ...newCacheRows];
      
      // We clear and update the sheet with the combined data
      await sheetsAPI.updateFullSheet('sheet_data', combinedRows);
      
      // Update last_synced_at and persistent counts
      row[6] = new Date().toISOString();
      if (!row[5] || row[5] === '[]') {
        row[5] = JSON.stringify(headers.map((h, i) => ({ name: String(h).trim(), index: i, type: 'string' })));
      }
      
      // Calculate counts for persistent storage
      const totalCount = dataRows.length;
      const verifiedCount = newCacheRows.filter(r => {
        try {
          const obj = JSON.parse(r[2]);
          return String(obj.verification || '').toLowerCase() === 'verified';
        } catch(e) { return false; }
      }).length;

      // Ensure row has enough columns for indices 11 and 12
      while(row.length < 13) row.push('');
      row[11] = String(totalCount);
      row[12] = String(verifiedCount);

      await sheetsAPI.updateRow('google_sheets', rowIndex, row);
      
      cache.invalidateSheetData();
      return { success: true, rows_synced: dataRows.length };
    } catch (e) {
      console.error('syncSpreadsheet error:', e);
      return { success: false, message: e.message };
    }
  }

  async getSheetDataForSpreadsheet(sheet_id) {
    const cacheKey = `raw-sheet-data:${sheet_id}`;
    return cache.getOrFetch(cacheKey, async () => {
      try {
        await sheetsAPI.ensureSheetExists('sheet_data', ['id', 'sheet_id', 'data_json']);
        
        // Fetch only the relevant sheet_id if possible, otherwise fetch all and filter
        // Optimization: Use a shared "Master Cache" for all sheets to avoid 100 calls
        const masterCacheKey = 'master-sheet-data';
        const allRows = await cache.getOrFetch(masterCacheKey, async () => {
          return await sheetsAPI.getSheetData('sheet_data!A:C');
        }, 30 * 1000); // 30 second master cache

        if (!allRows || !allRows.length) return [];
        const filtered = allRows.filter((r, i) => i !== 0 && r[1] === sheet_id);
        return filtered.map(r => {
          try {
            return JSON.parse(r[2]);
          } catch (e) { return {}; }
        });
      } catch (e) {
        console.error('getSheetDataForSpreadsheet error:', e);
        return [];
      }
    }, 10 * 1000); // 10 second per-sheet cache
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
          if (minutesSinceSync >= sheet.sync_interval_minutes) {
            console.log(`Auto-syncing spreadsheet: ${sheet.name} (${sheet.sheet_id})`);
            await this.syncSpreadsheet(sheet.sheet_id);
          }
        }
      }
    } catch (e) {
      console.error('syncAllActiveSpreadsheets error:', e);
    }
  }

  // ── Smart Bulk CSV Import using LangChain ──
  async bulkImport(sheet, records, added_by) {
    try {
      if (!records.length) return { success: false, message: 'CSV is empty' };
      
      // Ensure the sheet exists first
      const defaultHeaders = ['Sr.', 'Name', 'Mobile No', 'Address', 'State', 'Area', 'experience', 'Education', 'DOB', 'Age', 'Gender', 'Salary', 'Verification', 'Description', 'Since', 'Added By', 'Last Updated'];
      await sheetsAPI.ensureSheetExists(sheet, defaultHeaders);

      const rows = await sheetsAPI.getSheetData(`${sheet}!A:Z`);
      if (!rows.length) return { success: false, message: 'Target sheet not found' };
      const headers = rows[0];

      // 1. Determine mapping using LLM if MISTRAL_API_KEY exists
      let mapping = {};
      if (process.env.MISTRAL_API_KEY) {
        mapping = await this._getSmartMapping(records[0], records.slice(1, 4));
        console.log('[Smart Import] AI identified mapping:', mapping);
      }

      const today = new Date().toLocaleDateString('en-GB');
      let imported = 0, skipped = 0;
      const errors = [];
      const rowsToImport = [];
      
      // Standard schema aliases for fallback
      const fieldMap = {
        name: ['Name', 'Full Name', 'Candidate'], 
        mobile: ['Mobile No', 'Mobile', 'Phone', 'Contact'], 
        address: ['Address', 'Location'],
        state: ['State'], area: ['Area'], 
        experience: ['experience', 'Experience', 'Exp'],
        education: ['Education', 'Degree'], 
        dob: ['DOB', 'Date of Birth'], 
        gender: ['Gender'],
        salary: ['Salary', 'Expected Salary', 'Current Salary'], 
        verification: ['Verification', 'Status'], 
        description: ['Description', 'Notes', 'Remarks'],
        timing: ['Timing', 'Shift'], 
        marital_status: ['Marital status', 'Marital Status'],
        since: ['Since', 'Date'],
      };

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const row = Array.from({ length: headers.length }, () => '');
        
        // Handle Sr. No
        const srIdx = this.resolveHeaderIndex(headers, ['Sr.', 'Sr', 'Sr No', 'Sr. No']);
        const lastSr = rows.length > 1 && srIdx >= 0 ? parseInt(rows[rows.length-1][srIdx]) || 0 : 0;
        if (srIdx >= 0) row[srIdx] = lastSr + imported + 1;

        // Apply Smart Mapping or Fallback
        Object.keys(fieldMap).forEach((schemaKey) => {
          // Priority 1: Smart AI Mapping
          let val = '';
          const csvCol = mapping[schemaKey];
          if (csvCol && rec[csvCol]) {
            val = rec[csvCol];
          } else {
            // Priority 2: Traditional Alias Fallback
            const aliases = fieldMap[schemaKey];
            for (const alias of aliases) {
              const possible = rec[alias] || rec[alias.toLowerCase()] || rec[alias.toUpperCase()] || '';
              if (possible) { val = possible; break; }
            }
          }

          if (val) this.setIfHeaderExists(row, headers, fieldMap[schemaKey], val);
        });

        // Ensure Name exists
        const nameVal = row[this.resolveHeaderIndex(headers, fieldMap.name)];
        if (!nameVal) { skipped++; errors.push(`Row ${i+2}: Missing name`); continue; }

        // Metadata
        this.setIfHeaderExists(row, headers, ['Added By'], added_by || 'Smart Import');
        this.setIfHeaderExists(row, headers, ['Last Updated'], new Date().toISOString());
        this.setIfHeaderExists(row, headers, ['Since'], rec.since || rec.Since || today);

        rowsToImport.push(row);
        rows.push(row);
        imported++;
      }

      // Batch write all records at once to avoid quota errors
      if (rowsToImport.length > 0) {
        await sheetsAPI.appendRows(`${sheet}!A:Z`, rowsToImport);
      }

      cache.invalidateSheetData();
      await this.logActivity({ action: 'Smart Import', user: added_by, details: `Imported ${imported} to ${sheet} (AI mapping used: ${!!process.env.MISTRAL_API_KEY})` });
      return { success: true, imported, skipped, errors: errors.slice(0, 10) };
    } catch (e) {
      console.error('Smart import error:', e);
      return { success: false, message: 'Smart import failed: ' + e.message };
    }
  }

  async _getSmartMapping(firstRow, samples) {
    try {
      const model = new ChatMistralAI({
        apiKey: process.env.MISTRAL_API_KEY,
        modelName: 'mistral-small-latest',
        temperature: 0,
      });

      const parser = StructuredOutputParser.fromZodSchema(
        zod.object({
          name: zod.string().describe("The CSV column name for candidate name"),
          mobile: zod.string().describe("The CSV column name for phone/mobile"),
          address: zod.string().describe("The CSV column name for address"),
          state: zod.string().describe("The CSV column name for state"),
          area: zod.string().describe("The CSV column name for area"),
          experience: zod.string().describe("The CSV column name for work experience"),
          education: zod.string().describe("The CSV column name for education"),
          dob: zod.string().describe("The CSV column name for date of birth"),
          gender: zod.string().describe("The CSV column name for gender"),
          salary: zod.string().describe("The CSV column name for salary"),
          description: zod.string().describe("The CSV column name for notes or description"),
          timing: zod.string().describe("The CSV column name for work timing/shift"),
          marital_status: zod.string().describe("The CSV column name for marital status"),
        })
      );

      const formatInstructions = parser.getFormatInstructions();
      const prompt = new PromptTemplate({
        template: "You are an HR data specialist. Map the columns of a user-uploaded CSV to our HRMS schema.\n{format_instructions}\n\nCSV Headers: {headers}\nSample Data: {samples}\n\nSchema keys: name, mobile, address, state, area, experience, education, dob, gender, salary, description, timing, marital_status.\nIf a column doesn't exist, return empty string for that key.",
        inputVariables: ["headers", "samples"],
        partialVariables: { format_instructions: formatInstructions },
      });

      const input = await prompt.format({
        headers: Object.keys(firstRow).join(', '),
        samples: JSON.stringify(samples),
      });

      const response = await model.invoke(input);
      return await parser.parse(response.content);
    } catch (err) {
      console.warn('[Smart Mapping] LLM failed, using fallback:', err.message);
      return {};
    }
  }

  async validateCSVImport(records, mapping, sheetName, user) {
    const errors = [];
    let validCount = 0;
    
    try {
      // Fetch existing candidates for duplicate check
      const existing = await this.getSheetData(sheetName || 'all', 1, 10000, user);
      const existingMobiles = new Set((existing.data || []).map(c => String(c.mobile || '').trim()));

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const rowErrors = [];
        const mapped = {};
        
        Object.keys(mapping).forEach(dbField => {
          const csvCol = mapping[dbField];
          if (csvCol && rec[csvCol] !== undefined) {
            mapped[dbField] = String(rec[csvCol] || '').trim();
          }
        });

        // Validations
        if (!mapped.name) rowErrors.push("Name is required");
        if (!mapped.mobile) rowErrors.push("Mobile is required");
        else {
          if (existingMobiles.has(mapped.mobile)) rowErrors.push(`Duplicate: mobile ${mapped.mobile} already exists`);
          if (!/^\d{10}$/.test(mapped.mobile)) rowErrors.push("Mobile must be 10 digits");
        }
        
        // Email check if mapping provided
        if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) {
          rowErrors.push("Invalid email format");
        }

        if (rowErrors.length > 0) {
          errors.push({ row: i + 2, reason: rowErrors.join(", "), data: rec });
        } else {
          validCount++;
        }
      }
      return { success: true, validCount, errorCount: errors.length, errors };
    } catch (e) {
      console.error("CSV Validate Error:", e);
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

      // Ensure the sheet exists first
      const defaultHeaders = ['Sr.', 'Name', 'Mobile No', 'Address', 'State', 'Area', 'experience', 'Education', 'DOB', 'Age', 'Gender', 'Salary', 'Verification', 'Description', 'Since', 'Added By', 'Last Updated'];
      await sheetsAPI.ensureSheetExists(sheetName, defaultHeaders);

      // Fetch headers
      const rows = await sheetsAPI.getSheetData(`${sheetName}!A:Z`);
      if (!rows.length) throw new Error("Target sheet not found or empty");
      const headers = rows[0];
      
      let imported = 0;
      const today = new Date().toLocaleDateString('en-GB');

      // Batch processing (size 100)
      const BATCH_SIZE = 100;
      const fieldMap = {
        name: ['Name', 'Full Name', 'Candidate'],
        mobile: ['Mobile No', 'Mobile', 'Phone', 'Contact'],
        address: ['Address', 'Location'],
        state: ['State'], area: ['Area'],
        experience: ['experience', 'Experience', 'Exp'],
        education: ['Education', 'Degree'],
        dob: ['DOB', 'Date of Birth'],
        gender: ['Gender'],
        salary: ['Salary', 'Expected Salary'],
        description: ['Description', 'Notes', 'Remarks'],
        timing: ['Timing', 'Shift'],
        marital_status: ['Marital status'],
      };

      for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
        const batch = validRecords.slice(i, i + BATCH_SIZE);
        const rowsToAppend = [];
        
        // Refetch current max Sr No for each batch to minimize conflicts
        const currentData = await sheetsAPI.getSheetData(`${sheetName}!A:Z`);
        const srIdx = this.resolveHeaderIndex(headers, ['Sr.', 'Sr', 'Sr No', 'Sr. No']);
        let lastSr = currentData.length > 1 && srIdx >= 0 ? parseInt(currentData[currentData.length - 1][srIdx]) || 0 : 0;

        for (const rec of batch) {
          const row = Array.from({ length: headers.length }, () => '');
          if (srIdx >= 0) row[srIdx] = ++lastSr;

          Object.keys(mapping).forEach(dbField => {
            const csvCol = mapping[dbField];
            if (csvCol && rec[csvCol] !== undefined) {
              const val = String(rec[csvCol] || '').trim();
              if (fieldMap[dbField]) {
                this.setIfHeaderExists(row, headers, fieldMap[dbField], val);
              }
            }
          });

          // Metadata
          this.setIfHeaderExists(row, headers, ['Added By', 'Modified By', 'AddedBy', 'ModifiedBy'], user?.login_id || 'CSV Import');
          this.setIfHeaderExists(row, headers, ['Last Updated', 'Updated At'], new Date().toISOString());
          this.setIfHeaderExists(row, headers, ['Since'], today);

          rowsToAppend.push(row);
          imported++;
        }
        
        await sheetsAPI.appendRows(`${sheetName}!A:Z`, rowsToAppend);
      }

      cache.invalidateSheetData();
      await this.logActivity({ 
        action: 'CSV Import', 
        user: user?.login_id, 
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

  async getGrantsForSheet(sheet_id) {
    try {
      await this.ensureGrantsSheet();
      const rows = await sheetsAPI.getSheetData('sheet_access_grants!A:D');
      const grants = sheetsAPI.rowsToObjects(rows);
      return grants.filter(g => (g.sheet_id || g['sheet id']) === sheet_id);
    } catch (e) {
      return [];
    }
  }

  async updateGrantsForSheet(sheet_id, user_ids, granted_by) {
    try {
      await this.ensureGrantsSheet();
      const rows = await sheetsAPI.getSheetData('sheet_access_grants!A:D');
      const headers = (rows && rows.length > 0) ? rows[0] : ['sheet_id', 'user_id', 'granted_by', 'granted_at'];
      const sheetIdIdx = this.resolveHeaderIndex(headers, ['sheet_id', 'sheet id']);
      
      // Filter out existing grants for this sheet
      const newRows = [headers];
      if (rows && rows.length > 1) {
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][sheetIdIdx] !== sheet_id) {
            newRows.push(rows[i]);
          }
        }
      }

      // Add new grants
      const now = new Date().toISOString();
      for (const user_id of user_ids) {
        const row = Array.from({ length: headers.length }, () => '');
        this.setIfHeaderExists(row, headers, ['sheet_id', 'sheet id'], sheet_id);
        this.setIfHeaderExists(row, headers, ['user_id', 'user id'], user_id);
        this.setIfHeaderExists(row, headers, ['granted_by', 'granted by'], granted_by);
        this.setIfHeaderExists(row, headers, ['granted_at', 'granted at'], now);
        newRows.push(row);
      }

      await sheetsAPI.updateFullSheet('sheet_access_grants', newRows);
      cache.invalidateSheetData();
      return { success: true };
    } catch (err) {
      console.error('updateGrantsForSheet error:', err);
      return { success: false, message: err.message };
    }
  }

  // Helper to auto-register primary sheets if they aren't registered
  async autoRegisterPrimarySheets() {
    try {
      const registered = await this.getRegisteredSpreadsheets();
      const primarySheets = await sheetsAPI.getSheetNames();
      const spreadsheetId = process.env.SPREADSHEET_ID;

      for (const name of primarySheets) {
        if (EXCLUDED_SHEETS.has(name.toLowerCase())) continue;
        if (!registered.find(r => r.name === name && r.sheet_id === spreadsheetId)) {
          console.log(`Auto-registering primary sheet: ${name}`);
          // Add dummy entry for primary sheets
          const newId = uuidv4();
          const row = [
            newId,
            spreadsheetId,
            name,
            'Auto-registered primary sheet',
            name,
            '[]',
            '',
            '15',
            'true',
            'System',
            new Date().toISOString(),
          ];
          await sheetsAPI.appendRow('google_sheets!A:K', row);
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
