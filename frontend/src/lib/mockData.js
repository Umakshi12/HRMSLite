// Mock data engine for demo mode (works without live backend)
const DEMO_SHEETS = ['Japa', 'Elderly Care', 'Patient Care', 'Newborn Baby Care', 'Cook', 'Driver', 'Maid / Housekeeping']

const NAMES_F = ['Anita Sharma', 'Sunita Devi', 'Priya Yadav', 'Kavita Kumari', 'Meena Patel', 'Rekha Singh', 'Suman Gupta', 'Neha Joshi', 'Pooja Verma', 'Geeta Rawat', 'Rani Devi', 'Lakshmi Nair', 'Sarita Mishra', 'Kamla Devi', 'Usha Kumari', 'Radha Rani', 'Sita Devi', 'Pushpa Kumari', 'Asha Devi', 'Mamta Singh']
const NAMES_M = ['Rajesh Kumar', 'Suresh Yadav', 'Amit Sharma', 'Vikram Singh', 'Rahul Gupta', 'Anil Patel', 'Manoj Kumar', 'Deepak Verma', 'Ravi Shankar', 'Sunil Mishra']
const AREAS = ['Bandra', 'Andheri', 'Powai', 'Juhu', 'Malad', 'Borivali', 'Airoli', 'Vashi', 'Thane', 'Goregaon', 'Vasant Vihar', 'Dwarka', 'Saket', 'Rohini', 'Janakpuri', 'Lajpat Nagar', 'Nehru Place', 'Noida', 'Gurgaon', 'Faridabad']
const STATES = ['Maharashtra', 'Delhi', 'Uttar Pradesh', 'Bihar', 'West Bengal', 'Rajasthan', 'Madhya Pradesh', 'Karnataka', 'Tamil Nadu', 'Gujarat']
const EXP = ['<1 year', '1-2 years', '2-5 years', '5-8 years', '8+ years']
const EDU = ['<10th Pass', '10th Pass', '12th Pass', 'Graduate', 'Other']
const TIMING = ['8 hrs', 'Full time', 'Part time', 'Live-in']
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed']
const VERIFY = ['verified', 'not verified', 'pending']
const DESCRIPTIONS = [
  'Experienced in elderly care, patient and caring',
  'Good with newborn babies, knows infant massage',
  'Expert cook, specializes in North Indian cuisine',
  'Licensed driver with clean record, knows city routes',
  'Housekeeping expert, thorough and reliable',
  'Trained nurse, can handle medical equipment',
  'Experienced with dementia patients',
  'Can cook South Indian and Chinese food',
  'Knows basic first aid and CPR',
  'Fluent in Hindi and English, good communication',
]

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function randDate(yearMin, yearMax) {
  const d = randInt(1, 28), m = randInt(1, 12), y = randInt(yearMin, yearMax)
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`
}
function calcAge(dob) {
  if (!dob) return 0
  const [d, m, y] = dob.split('-').map(Number)
  return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 31557600000)
}

// Generate all demo data once
let _cache = null
function generateAllData() {
  if (_cache) return _cache
  const data = {}
  DEMO_SHEETS.forEach((sheet) => {
    const count = randInt(40, 150)
    const rows = []
    for (let i = 1; i <= count; i++) {
      const gender = Math.random() > 0.3 ? 'Female' : 'Male'
      const name = gender === 'Female' ? rand(NAMES_F) : rand(NAMES_M)
      const dob = randDate(1970, 2002)
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
        salary: [0, 8000, 10000, 12000, 15000, 18000, 20000, 25000, 30000][randInt(0, 8)],
        mobile: String(randInt(7000000000, 9999999999)),
        verification: rand(VERIFY),
        description: rand(DESCRIPTIONS),
        since: randDate(2023, 2026),
        sheet,
      })
    }
    data[sheet] = rows
  })
  _cache = data
  return data
}

// ── Public API (mirrors real API responses) ──

export function getSheets() {
  return DEMO_SHEETS
}

export function mockGetSheetSummary() {
  const data = generateAllData()
  const sheets = Object.entries(data).map(([name, rows]) => ({
    name,
    count: rows.length,
    verified: rows.filter((r) => r.verification === 'verified').length,
  }))
  const total = sheets.reduce((s, sh) => s + sh.count, 0)
  const totalVerified = sheets.reduce((s, sh) => s + sh.verified, 0)
  const thisMonth = Object.values(data).flat().filter((r) => {
    const [, m, y] = (r.since || '').split('-').map(Number)
    const now = new Date()
    return y === now.getFullYear() && m === now.getMonth() + 1
  }).length
  return { sheets, added_this_month: thisMonth, total, total_verified: totalVerified }
}

export function mockGetSheetData(sheet, page = 1, limit = 50) {
  const data = generateAllData()
  const rows = data[sheet] || []
  const start = (page - 1) * limit
  return { total: rows.length, page, data: rows.slice(start, start + limit) }
}

export function mockAddCandidate(sheet, candidate) {
  const data = generateAllData()
  if (!data[sheet]) data[sheet] = []
  const sr_no = data[sheet].length + 1
  const newRow = { ...candidate, sr_no, sheet, age: calcAge(candidate.dob) }
  data[sheet].unshift(newRow)
  return { success: true, sr_no }
}

export function mockEditCandidate(sr_no, sheet, updates) {
  const data = generateAllData()
  const rows = data[sheet] || []
  const idx = rows.findIndex((r) => r.sr_no === sr_no)
  if (idx >= 0) {
    rows[idx] = { ...rows[idx], ...updates, age: calcAge(updates.dob || rows[idx].dob) }
    return { success: true }
  }
  return { success: false, message: 'Candidate not found' }
}

export function mockCheckMobile(mobile, exclude_sr_no) {
  const data = generateAllData()
  for (const [sheet, rows] of Object.entries(data)) {
    const found = rows.find((r) => r.mobile === mobile && r.sr_no !== exclude_sr_no)
    if (found) return { exists: true, sheet }
  }
  return { exists: false }
}

export function mockGetUsers() {
  return {
    users: [
      { login_id: 'staffurs_admin01', identifier: 'admin@staffurs.com', role: 'Admin', status: 'active', last_login: new Date().toISOString(), sheet_access: ['All'] },
      { login_id: 'staffurs_user01', identifier: 'user@staffurs.com', role: 'User', status: 'active', last_login: '', sheet_access: ['All'] },
    ],
  }
}
