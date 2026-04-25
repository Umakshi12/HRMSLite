// Backend Base URL - Use relative path for production (works with Vercel rewrites)
export const API_BASE = '/api';

export const API = {
  LOGIN:            `${API_BASE}/login`,
  CHANGE_PASSWORD:  `${API_BASE}/change-password`,
  GET_SHEET_DATA:   `${API_BASE}/get-sheet-data`,
  GET_SUMMARY:      `${API_BASE}/get-sheet-summary`,
  AI_SEARCH:        `${API_BASE}/ai-search`,
  APPLY_FILTERS:    `${API_BASE}/apply-filters`,
  ADD_CANDIDATE:    `${API_BASE}/add-candidate`,
  EDIT_CANDIDATE:   `${API_BASE}/edit-candidate`,
  REMOVE_CANDIDATE: `${API_BASE}/remove-candidate`,
  CHECK_MOBILE:     `${API_BASE}/check-mobile`,
  GRANT_ACCESS:     `${API_BASE}/grant-access`,
  RESET_PASSWORD:   `${API_BASE}/reset-password`,
  UPDATE_RIGHTS:    `${API_BASE}/update-user-rights`,
  REMOVE_USER:      `${API_BASE}/remove-user`,
  GET_USERS:        `${API_BASE}/get-users`,
  GET_ACTIVITY_LOG: `${API_BASE}/get-activity-log`,
  GET_FILTER_OPTIONS: `${API_BASE}/get-filter-options`,
  CLEAR_CACHE:      `${API_BASE}/clear-cache`,
}

// Dynamic sheets — these are fetched from the backend at runtime
// This static list is ONLY used as a fallback if the API is unreachable
export const SHEETS_FALLBACK = [
  'Japa',
  'Elderly Care',
  'Patient Care',
  'Newborn Baby Care',
  'Cook',
  'Driver',
  'Maid / Housekeeping'
]

export const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Chandigarh','Puducherry',
]

export const EXPERIENCE_OPTIONS = ['<1 year', '1-2 years', '2-5 years', '5-8 years', '5-10 years', '8+ years', '10+ years']
export const EDUCATION_OPTIONS = ['<10th Pass', '9th Pass', '10th Pass', '12th Pass', 'Graduate', 'Other']
export const TIMING_OPTIONS = ['6 hrs', '8 hrs', '10 hrs', 'Full time', 'Part time', 'Part-time', 'Live-in']
export const MARITAL_OPTIONS = ['Single', 'Unmarried', 'Married', 'Divorced', 'Widowed']
export const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'male', 'female']
export const VERIFICATION_OPTIONS = ['verified', 'not verified', 'pending']
