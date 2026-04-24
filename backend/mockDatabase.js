import { v4 as uuidv4 } from 'uuid';

const DEMO_SHEETS = ['Japa', 'Elderly Care', 'Patient Care', 'Newborn Baby Care', 'Cook', 'Driver', 'Maid / Housekeeping'];

const NAMES_F = ['Anita Sharma', 'Sunita Devi', 'Priya Yadav', 'Kavita Kumari', 'Meena Patel', 'Rekha Singh', 'Suman Gupta'];
const NAMES_M = ['Rajesh Kumar', 'Suresh Yadav', 'Amit Sharma', 'Vikram Singh', 'Rahul Gupta', 'Anil Patel', 'Manoj Kumar'];
const AREAS = ['Bandra', 'Andheri', 'Powai', 'Juhu', 'Malad', 'Borivali', 'Vasant Vihar', 'Dwarka', 'Saket'];
const STATES = ['Maharashtra', 'Delhi', 'Uttar Pradesh', 'Bihar', 'Rajasthan', 'Karnataka', 'Gujarat'];
const EXP = ['<1 year', '1-2 years', '2-5 years', '5-8 years', '8+ years'];
const EDU = ['<10th Pass', '10th Pass', '12th Pass', 'Graduate', 'Other'];
const TIMING = ['8 hrs', 'Full time', 'Part time', 'Live-in'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];
const VERIFY = ['verified', 'not verified', 'pending'];
const DESCRIPTIONS = [
  'Experienced in elderly care, patient and caring',
  'Good with newborn babies, knows infant massage',
  'Expert cook, specializes in North Indian cuisine',
  'Licensed driver with clean record, knows city routes',
  'Housekeeping expert, thorough and reliable',
];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randDate(yearMin, yearMax) {
  const d = randInt(1, 28), m = randInt(1, 12), y = randInt(yearMin, yearMax);
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
}
function calcAge(dob) {
  if (!dob) return 0;
  const [d, m, y] = dob.split('-').map(Number);
  return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 31557600000);
}

class MockDatabase {
  constructor() {
    this.data = {};
    this.users = [
      { login_id: 'staffurs_admin01', identifier: 'admin@staffurs.com', role: 'Admin', status: 'active', pass: 'admin123', last_login: new Date().toISOString(), sheet_access: ['All'] },
      { login_id: 'staffurs_user01', identifier: 'user@staffurs.com', role: 'User', status: 'active', pass: 'user123', last_login: '', sheet_access: ['All'] },
    ];
    this.logs = [];
    this.initializeData();
  }

  initializeData() {
    DEMO_SHEETS.forEach((sheet) => {
      const count = randInt(20, 50); // smaller count for backend mock to save memory
      const rows = [];
      for (let i = 1; i <= count; i++) {
        const gender = Math.random() > 0.3 ? 'Female' : 'Male';
        const name = gender === 'Female' ? rand(NAMES_F) : rand(NAMES_M);
        const dob = randDate(1970, 2002);
        rows.push({
          sr_no: i,
          name,
          address: `${randInt(1, 500)}, ${rand(AREAS)} Road`,
          state: rand(STATES),
          marital_status: rand(MARITAL),
          timing: rand(TIMING),
          area: rand(AREAS),
          experience: rand(EXP),
          education: rand(EDU),
          dob,
          age: calcAge(dob),
          gender,
          salary: [10000, 12000, 15000, 18000, 20000, 25000][randInt(0, 5)],
          mobile: String(randInt(7000000000, 9999999999)),
          verification: rand(VERIFY),
          description: rand(DESCRIPTIONS),
          since: randDate(2023, 2026),
          sheet,
        });
      }
      this.data[sheet] = rows;
    });
  }

  getSheets() {
    return DEMO_SHEETS;
  }

  getSheetSummary() {
    const sheets = Object.entries(this.data).map(([name, rows]) => ({
      name,
      count: rows.length,
      verified: rows.filter((r) => r.verification === 'verified').length,
    }));
    const total = sheets.reduce((s, sh) => s + sh.count, 0);
    const totalVerified = sheets.reduce((s, sh) => s + sh.verified, 0);
    const thisMonth = Object.values(this.data).flat().filter((r) => {
      const [, m, y] = (r.since || '').split('-').map(Number);
      const now = new Date();
      return y === now.getFullYear() && m === now.getMonth() + 1;
    }).length;
    return { sheets, added_this_month: thisMonth, total, total_verified: totalVerified };
  }

  getSheetData(sheet, page = 1, limit = 50) {
    const rows = this.data[sheet] || [];
    const start = (page - 1) * limit;
    return { total: rows.length, page, data: rows.slice(start, start + limit) };
  }

  applyFilters(sheet, filters, page = 1, limit = 50) {
    let rows = this.data[sheet] || [];
    if (filters.gender?.length) rows = rows.filter((r) => filters.gender.includes(r.gender));
    if (filters.experience?.length) rows = rows.filter((r) => filters.experience.includes(r.experience));
    if (filters.education?.length) rows = rows.filter((r) => filters.education.includes(r.education));
    if (filters.verification?.length) rows = rows.filter((r) => filters.verification.includes(r.verification));
    
    const start = (page - 1) * limit;
    return { total: rows.length, page, data: rows.slice(start, start + limit) };
  }

  addCandidate(sheet, candidate, added_by) {
    if (!this.data[sheet]) this.data[sheet] = [];
    const sr_no = this.data[sheet].length > 0 ? Math.max(...this.data[sheet].map(r => r.sr_no || 0)) + 1 : 1;
    const newRow = { ...candidate, sr_no, sheet, age: calcAge(candidate.dob) };
    this.data[sheet].unshift(newRow);
    this.logs.push({ id: uuidv4(), action: 'Added Candidate', user: added_by || 'Unknown', details: `Added ${candidate.name} to ${sheet}`, timestamp: new Date().toISOString() });
    return { success: true, sr_no };
  }

  editCandidate(sr_no, sheet, target_sheet, updated_fields, updated_by) {
    const rows = this.data[sheet] || [];
    const idx = rows.findIndex((r) => r.sr_no === sr_no);
    if (idx >= 0) {
      if (target_sheet && target_sheet !== sheet) {
        // Move to another sheet
        const item = { ...rows[idx], ...updated_fields, sheet: target_sheet, age: calcAge(updated_fields.dob || rows[idx].dob) };
        rows.splice(idx, 1);
        if (!this.data[target_sheet]) this.data[target_sheet] = [];
        this.data[target_sheet].unshift(item);
      } else {
        rows[idx] = { ...rows[idx], ...updated_fields, age: calcAge(updated_fields.dob || rows[idx].dob) };
      }
      this.logs.push({ id: uuidv4(), action: 'Edited Candidate', user: updated_by || 'Unknown', details: `Edited SR_NO ${sr_no} in ${sheet}`, timestamp: new Date().toISOString() });
      return { success: true };
    }
    return { success: false, message: 'Candidate not found' };
  }

  checkMobile(mobile, exclude_sr_no) {
    for (const [sheet, rows] of Object.entries(this.data)) {
      const found = rows.find((r) => r.mobile === mobile && String(r.sr_no) !== String(exclude_sr_no));
      if (found) return { exists: true, sheet };
    }
    return { exists: false };
  }

  // User Management
  getUser(identifier) {
    return this.users.find(u => u.identifier === identifier);
  }

  login(identifier, password) {
    const user = this.users.find(u => u.identifier === identifier && u.pass === password);
    if (user) {
      user.last_login = new Date().toISOString();
      return { success: true, token: 'mock-jwt-token-' + uuidv4(), user: { login_id: user.login_id, identifier: user.identifier, role: user.role, sheet_access: user.sheet_access } };
    }
    return { success: false, message: 'Invalid credentials' };
  }

  changePassword(login_id, old_password, new_password) {
    const user = this.users.find(u => u.login_id === login_id);
    if (user && user.pass === old_password) {
      user.pass = new_password;
      return { success: true, message: 'Password changed successfully' };
    }
    return { success: false, message: 'Invalid old password' };
  }

  grantAccess(data) {
    const newLoginId = 'staffurs_' + Math.random().toString(36).slice(2, 8);
    this.users.push({
      login_id: newLoginId,
      identifier: data.identifier,
      role: data.role || 'User',
      status: 'active',
      pass: 'welcome123', // Default pass
      sheet_access: data.sheet_access || [],
      last_login: ''
    });
    this.logs.push({ id: uuidv4(), action: 'Granted Access', user: data.added_by || 'Admin', details: `Granted access to ${data.identifier}`, timestamp: new Date().toISOString() });
    return { success: true, login_id: newLoginId, message: 'Access granted successfully' };
  }

  resetPassword(target_login_id, reset_by) {
    const user = this.users.find(u => u.login_id === target_login_id);
    if (user) {
      user.pass = 'welcome123';
      this.logs.push({ id: uuidv4(), action: 'Reset Password', user: reset_by || 'Admin', details: `Reset password for ${target_login_id}`, timestamp: new Date().toISOString() });
      return { success: true, message: 'Password reset to default' };
    }
    return { success: false, message: 'User not found' };
  }

  updateUserRights(data) {
    const user = this.users.find(u => u.login_id === data.target_login_id);
    if (user) {
      user.role = data.role || user.role;
      user.sheet_access = data.sheet_access || user.sheet_access;
      this.logs.push({ id: uuidv4(), action: 'Updated Rights', user: data.updated_by || 'Admin', details: `Updated rights for ${data.target_login_id}`, timestamp: new Date().toISOString() });
      return { success: true, message: 'Rights updated successfully' };
    }
    return { success: false, message: 'User not found' };
  }

  removeUser(target_login_id, removed_by) {
    this.users = this.users.filter(u => u.login_id !== target_login_id);
    this.logs.push({ id: uuidv4(), action: 'Removed User', user: removed_by || 'Admin', details: `Removed user ${target_login_id}`, timestamp: new Date().toISOString() });
    return { success: true, message: 'User removed successfully' };
  }

  getUsers() {
    return { users: this.users.map(({ pass, ...rest }) => rest) }; // hide passwords
  }

  getActivityLog(page = 1, limit = 50) {
    const start = (page - 1) * limit;
    // Sort descending by timestamp
    const sortedLogs = [...this.logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { total: this.logs.length, logs: sortedLogs.slice(start, start + limit) };
  }
}

// Singleton instance
const db = new MockDatabase();
export default db;
