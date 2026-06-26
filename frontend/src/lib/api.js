import useStore from './store'
import { API } from './config'

/** Tracks whether the live backend is currently unreachable */
let demoMode = false
export const isDemoMode = () => demoMode

/** 
 * SECURITY: Sanitize user input for formula injection (=, +, -, @) 
 * Prevents malicious data from executing in Excel/Google Sheets
 */
export const sanitizeValue = (val) => {
  if (typeof val !== 'string') return val
  const formulaChars = ['=', '+', '-', '@']
  if (formulaChars.includes(val.charAt(0))) {
    return "'" + val
  }
  return val
}

export const sanitizeObject = (obj) => {
  const sanitized = { ...obj }
  Object.keys(sanitized).forEach(key => {
    sanitized[key] = sanitizeValue(sanitized[key])
  })
  return sanitized
}

/** Get auth headers */
function authHeaders() {
  const token = useStore.getState().token;
  return {
    'Content-Type': 'application/json',
    // SECURITY: Prioritize cookies, but keep Bearer support for legacy/mobile if needed
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/** Handle 401 → force logout */
function handleUnauth(res) {
  if (res.status === 401) {
    const { token, user, clearAuth } = useStore.getState()
    if (token || user) {
      clearAuth()
      // Only throw if we were previously authenticated to prevent infinite loops on login page
      throw new Error('Session expired')
    }
  }
  return res
}

/** Generic fetch wrapper — accepts full URL or /path (auto-prefixed with API_BASE) */
export async function apiFetch(urlOrPath, options = {}) {
  // SECURITY: Ensure API_BASE is set, never fallback to hardcoded localhost in prod
  const base = API.BASE || (import.meta.env.DEV ? 'http://localhost:5000/api' : '');
  if (!base && !urlOrPath.startsWith('http')) {
    throw new Error('API Base URL is not configured');
  }

  const url = urlOrPath.startsWith('http') ? urlOrPath : `${base}${urlOrPath}`;
  
  try {
    // SECURITY: Always include credentials for HttpOnly cookies
    const headers = { ...authHeaders(), ...options.headers };
    if (options.body instanceof FormData) {
      delete headers['Content-Type'];
    }
    const res = await fetch(url, { 
      ...options,
      headers, 
      credentials: 'include', 
    })
    
    // Only handle unauth for protected routes
    if (!url.includes('/login')) {
      handleUnauth(res)
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || `API Error: ${res.status} ${res.statusText}`)
    }

    const data = await res.json()
    return data
  } catch (err) {
    console.error(`Fetch Failure (${url}):`, err)
    // Don't trigger demo mode for auth/permission errors
    const isAuthError = err.message?.includes('401') || err.message?.includes('403') || err.message?.includes('Session expired')
    if (!isAuthError) {
      demoMode = true
    }
    throw err
  }
}

// ── Auth ──
export const login = (identifier, password) =>
  apiFetch(API.LOGIN, { method: 'POST', body: JSON.stringify({ identifier, password }) })

export const logout = () =>
  apiFetch('/logout', { method: 'POST' })

export const checkSession = () =>
  apiFetch('/me', { method: 'GET' })

export const changePassword = (login_id, old_password, new_password) =>
  apiFetch(API.CHANGE_PASSWORD, { method: 'POST', body: JSON.stringify({ login_id, old_password, new_password }) })

export const forgotPassword = (identifier) =>
  apiFetch('/forgot-password', { method: 'POST', body: JSON.stringify({ identifier }) })

// ── Data ──
export async function getSheetData(sheet, page = 1, limit = 50) {
  const url = sheet === 'all' || !sheet 
    ? `${API.GET_SHEET_DATA}?all=true&page=${page}&limit=${limit}`
    : `${API.GET_SHEET_DATA}?sheet=${encodeURIComponent(sheet)}&page=${page}&limit=${limit}`
  return apiFetch(url)
}

export async function getSheetSummary() {
  return apiFetch(API.GET_SUMMARY)
}

export async function applyFilters(sheet, filters, page = 1, limit = 50, tab = null) {
  return await apiFetch(API.APPLY_FILTERS, { method: 'POST', body: JSON.stringify({ sheet, filters, page, limit, ...(tab ? { tab } : {}) }) })
}

export async function addCandidate(sheet, candidate, added_by) {
  return await apiFetch(API.ADD_CANDIDATE, { method: 'POST', body: JSON.stringify({ sheet, candidate, added_by }) })
}

export async function editCandidate(sr_no, row_index, sheet, target_sheet, updated_fields, updated_by) {
  return await apiFetch(API.EDIT_CANDIDATE, { method: 'PUT', body: JSON.stringify({ sr_no, row_index, sheet, target_sheet, updated_fields, updated_by }) })
}

export async function removeCandidate(sr_no, row_index, sheet, removed_by) {
  return await apiFetch(API.REMOVE_CANDIDATE, { method: 'DELETE', body: JSON.stringify({ sr_no, row_index, sheet, removed_by }) })
}

export async function checkMobile(mobile, exclude_sr_no) {
  return await apiFetch(`${API.CHECK_MOBILE}?mobile=${mobile}${exclude_sr_no ? `&exclude_sr_no=${exclude_sr_no}` : ''}`)
}

// ── Admin ──
export async function grantAccess(data) {
  return await apiFetch(API.GRANT_ACCESS, { method: 'POST', body: JSON.stringify(data) })
}

export async function resetPassword(target_login_id, reset_by) {
  return await apiFetch(API.RESET_PASSWORD, { method: 'POST', body: JSON.stringify({ target_login_id, reset_by }) })
}

export async function updateUserRights(data) {
  return await apiFetch(API.UPDATE_RIGHTS, { method: 'PUT', body: JSON.stringify(data) })
}

export async function removeUser(target_login_id, removed_by) {
  return await apiFetch(API.REMOVE_USER, { method: 'DELETE', body: JSON.stringify({ target_login_id, removed_by }) })
}

export async function getUsers() {
  return await apiFetch(API.GET_USERS)
}

export async function updateUserLimit(target_login_id, max_users) {
  return await apiFetch(API.UPDATE_USER_LIMIT, { method: 'PUT', body: JSON.stringify({ target_login_id, max_users }) })
}

export async function getFilterOptions(sheet) {
  return await apiFetch(`${API.GET_FILTER_OPTIONS}?sheet=${encodeURIComponent(sheet || 'all')}`)
}

export async function getActivityLog(params) {
  return await apiFetch(`${API.GET_ACTIVITY_LOG}?${new URLSearchParams(params)}`)
}

// ── Spreadsheet Registry ──
export async function getAdminDashboard() {
  return await apiFetch(API.ADMIN_DASHBOARD)
}

export async function getSpreadsheets() {
  return await apiFetch(API.SPREADSHEETS)
}

export async function getServiceAccountEmail() {
  return await apiFetch('/service-account-email')
}

export async function addSpreadsheet(spreadsheet_id, name) {
  return await apiFetch(API.SPREADSHEETS, { method: 'POST', body: JSON.stringify({ spreadsheet_id, name }) })
}

export async function removeSpreadsheet(spreadsheet_id) {
  return await apiFetch(`${API.SPREADSHEETS}/${encodeURIComponent(spreadsheet_id)}`, { method: 'DELETE' })
}

export async function syncSpreadsheet(spreadsheet_id) {
  return await apiFetch(`${API.SPREADSHEETS}/${encodeURIComponent(spreadsheet_id)}/sync`, { method: 'POST' })
}

export async function syncAllSpreadsheets() {
  return await apiFetch(`${API.SPREADSHEETS}/sync-all`, { method: 'POST' })
}

export async function getSpreadsheetData(spreadsheet_id) {
  return await apiFetch(`${API.SPREADSHEETS}/${encodeURIComponent(spreadsheet_id)}/data`, { method: 'GET' })
}

export async function getSheetGrants(sheet_id) {
  return await apiFetch(`${API.SPREADSHEETS}/${encodeURIComponent(sheet_id)}/grants`, { method: 'GET' })
}

export async function updateSheetGrants(sheet_id, user_ids) {
  return await apiFetch(`${API.SPREADSHEETS}/${encodeURIComponent(sheet_id)}/grants`, { 
    method: 'POST', 
    body: JSON.stringify({ user_ids }) 
  })
}

// ── Bulk Import ──
export async function bulkImportCSV(sheet, file, onProgress) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('sheet', sheet)
  
  return await apiFetch(API.BULK_IMPORT, {
    method: 'POST',
    body: formData,
  })
}

export async function getSheetHeaders(sheet, tab) {
  const tabParam = tab ? `&tab=${encodeURIComponent(tab)}` : '';
  return apiFetch(`/import/sheet-headers?sheet=${encodeURIComponent(sheet)}${tabParam}`)
}

export async function importPreview(file) {
  const formData = new FormData()
  formData.append('file', file)
  
  return await apiFetch(API.IMPORT_PREVIEW, {
    method: 'POST',
    body: formData,
  })
}

export async function importValidate(file, mapping, sheet, tab) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mapping', JSON.stringify(mapping))
  formData.append('sheet', sheet)
  if (tab) formData.append('tab', tab)
  
  return await apiFetch(API.IMPORT_VALIDATE, {
    method: 'POST',
    body: formData,
  })
}

export async function importFinal(file, mapping, sheet, tab) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mapping', JSON.stringify(mapping))
  formData.append('sheet', sheet)
  if (tab) formData.append('tab', tab)
  
  return await apiFetch(API.IMPORT_CSV, {
    method: 'POST',
    body: formData,
  })
}

// ── SSE Search Stream (falls back to client-side Fuse.js in CandidateTable) ──
export function streamSearch(query, parsedIntent, sheet, searchAllSheets, onRow, onDone, onError) {
  const controller = new AbortController()
  fetch(API.AI_SEARCH, {
    method: 'POST',
    headers: { ...authHeaders(), Accept: 'text/event-stream' },
    body: JSON.stringify({ query, parsed_intent: parsedIntent, search_all_sheets: searchAllSheets, sheet }),
    signal: controller.signal,
  })
    .then(async (res) => {
      handleUnauth(res)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') { onDone(); return }
            try { onRow(JSON.parse(payload)) } catch {}
          }
        }
      }
      onDone()
    })
    .catch((err) => { if (err.name !== 'AbortError') onError(err) })

  return () => controller.abort()
}
