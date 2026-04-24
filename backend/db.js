import * as sheetsAPI from './googleSheetsService.js';
import { v4 as uuidv4 } from 'uuid';
import { sendWelcomeEmail } from './emailService.js';
import { hashPassword, comparePassword } from './auth.js';
import cache from './cache.js';

const FALLBACK_SHEETS = ['Japa', 'Elderly Care', 'Patient Care', 'Newborn Baby Care', 'Cook', 'Driver', 'Maid / Housekeeping'];

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

  async getCandidateSheets() {
    return cache.getOrFetch('sheet-names', async () => {
      try {
        const allSheets = await sheetsAPI.getSheetNames();
        const excluded = new Set(['users', 'activitylog', 'activity_logs', 'activity logs', 'config']);
        const candidateSheets = allSheets.filter((name) => !excluded.has(String(name).toLowerCase()));
        return candidateSheets.length ? candidateSheets : FALLBACK_SHEETS;
      } catch (err) {
        console.warn(`Falling back to static sheet list: ${err.message}`);
        return FALLBACK_SHEETS;
      }
    }, 10 * 60 * 1000);
  }

  async resolveTargetSheets(sheet) {
    if (sheet && sheet !== 'all') return [sheet];
    return this.getCandidateSheets();
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
      sheet: get('_sheet') || fallbackSheet,
      _sheet: get('_sheet') || fallbackSheet,
    };
  }

  /** Cached sheet data fetch - the key performance fix */
  async getCachedSheetData(sheetName) {
    const cacheKey = `sheet:${sheetName}`;
    return cache.getOrFetch(cacheKey, async () => {
      const rows = await sheetsAPI.getSheetData(`${sheetName}!A:U`);
      return sheetsAPI.rowsToObjects(rows).map((row) => this.normalizeCandidate(row, sheetName));
    }, 5 * 60 * 1000);
  }

  /** Load all candidate data across sheets with caching */
  async getAllCandidateData(sheet) {
    const sheetNames = await this.resolveTargetSheets(sheet);
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
      let rows = await sheetsAPI.getSheetData('Users!A:I');
      let users = sheetsAPI.rowsToObjects(rows);
      let user = users.find(u => u.email === identifier || u.identifier === identifier);
      if (!user) {
        rows = await sheetsAPI.getSheetData('activity logs!A:L');
        users = sheetsAPI.rowsToObjects(rows);
        user = users.find(u => u.email === identifier || u.identifier === identifier);
      }
      if (user) {
        let isMatch = false;
        if (user.password.startsWith('$2')) {
          isMatch = await comparePassword(password, user.password);
        } else {
          isMatch = (password === user.password || password === user.pass);
        }
        if (isMatch) {
          return {
            success: true,
            user: {
              login_id: user.login_id,
              identifier: user.email || user.identifier,
              role: user.role,
              sheet_access: this.safeParseAccess(user.sheet_access)
            }
          };
        }
      }
      return { success: false, message: 'Invalid credentials' };
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
      const row = [newLoginId, data.identifier, hashedPassword, data.role || 'User', 'active', '', JSON.stringify(data.sheet_access || []), new Date().toISOString()];
      await sheetsAPI.appendRow('Users!A:H', row);
      const emailSent = await sendWelcomeEmail(data.identifier, newLoginId, tempPassword);
      await this.logActivity({ action: 'Granted Access', user: data.added_by || 'Admin', details: `Granted access to ${data.identifier}. Email sent: ${emailSent}` });
      return { success: true, login_id: newLoginId, password: tempPassword, message: emailSent ? 'Access granted and welcome email sent.' : 'Access granted but email failed to send.' };
    } catch (err) {
      console.error('Grant Access Error:', err);
      return { success: false, message: 'Could not grant access. Ensure "Users" sheet exists.' };
    }
  }

  async getUsers() {
    const rows = await sheetsAPI.getSheetData('Users!A:H');
    const users = sheetsAPI.rowsToObjects(rows);
    return {
      users: users.map(u => ({
        login_id: u.login_id || u.loginid || u.login || '',
        identifier: u.email || u.identifier || u.phone || '',
        role: u.role || 'User',
        status: u.status || 'active',
        sheet_access: this.safeParseAccess(u.sheet_access || u.sheetaccess || '[]'),
      }))
    };
  }

  // ── Candidates (CACHED) ──
  async getSheetData(sheet, page = 1, limit = 50) {
    try {
      const allData = await this.getAllCandidateData(sheet);
      const total = allData.length;
      const start = (page - 1) * limit;
      return { total, page, data: allData.slice(start, start + limit) };
    } catch (err) {
      console.error(`Error fetching sheet ${sheet}:`, err);
      return { total: 0, page, data: [] };
    }
  }

  async getSheetSummary() {
    return cache.getOrFetch('sheet-summary', async () => {
      const sheetNames = await this.getCandidateSheets();
      const sheets = [];
      let grandTotal = 0, grandVerified = 0;
      const results = await Promise.allSettled(
        sheetNames.map((name) => this.getCachedSheetData(name).then(data => ({ name, data })))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { name, data } = r.value;
          const count = data.length;
          const verified = data.filter(c => c.verification === 'verified').length;
          sheets.push({ name, count, verified });
          grandTotal += count;
          grandVerified += verified;
        } else {
          sheets.push({ name: 'Unknown', count: 0, verified: 0 });
        }
      }
      return { sheets, added_this_month: 0, total: grandTotal, total_verified: grandVerified };
    }, 3 * 60 * 1000);
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
      this.setIfHeaderExists(row, headers, ['Added By', 'Updated By'], added_by || 'System');
      this.setIfHeaderExists(row, headers, ['Last Updated'], new Date().toISOString());
      this.setIfHeaderExists(row, headers, ['_sheet'], sheet);
      await sheetsAPI.appendRow(`${sheet}!A:U`, row);
      cache.invalidateSheetData();
      return { success: true, sr_no };
    } catch (err) {
      console.error('Add Candidate Error:', err);
      return { success: false, message: 'Could not add candidate. Ensure sheet exists.' };
    }
  }

  async logActivity(log) {
    try {
      const row = [log.action, log.user, log.details, new Date().toISOString()];
      await sheetsAPI.appendRow('ActivityLog!A:D', row);
    } catch (err) { console.error('Log Activity Error:', err); }
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
  async applyFilters(sheet, filters, page = 1, limit = 50) {
    try {
      let allData = await this.getAllCandidateData(sheet);

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

  async getFilterOptions(sheet) {
    const cacheKey = `filter-opts:${sheet || 'all'}`;
    return cache.getOrFetch(cacheKey, async () => {
      try {
        const allData = await this.getAllCandidateData(sheet);
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
      };
      Object.entries(updated_fields).forEach(([key, val]) => {
        const aliases = fieldMap[key];
        if (aliases) this.setIfHeaderExists(existingRow, originalHeaders, aliases, val);
      });
      // Recalculate age from DOB if provided
      if (updated_fields.dob) {
        this.setIfHeaderExists(existingRow, originalHeaders, ['Age'], this.calculateAge(updated_fields.dob));
      }
      this.setIfHeaderExists(existingRow, originalHeaders, ['Updated By', 'Added By'], updated_by || this.getIfHeaderExists(existingRow, originalHeaders, ['Updated By', 'Added By']));
      this.setIfHeaderExists(existingRow, originalHeaders, ['Last Updated'], new Date().toISOString());
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

  async checkMobile(mobile, exclude_sr_no) {
    const allData = await this.getAllCandidateData('all');
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
    const rows = await sheetsAPI.getSheetData('Users!A:I');
    const userRow = rows[rowIndex];
    userRow[3] = data.role || userRow[3];
    userRow[5] = JSON.stringify(data.sheet_access || []);
    await sheetsAPI.updateRow('Users', rowIndex, userRow);
    return { success: true };
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
