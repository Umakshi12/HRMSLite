import useStore from './store'
import { API } from './config'

/** Tracks whether the live backend is currently unreachable */
let demoMode = false
export const isDemoMode = () => demoMode

/** Get auth headers */
function authHeaders() {
  const token = useStore.getState().token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/** Handle 401 → force logout */
function handleUnauth(res) {
  if (res.status === 401) {
    useStore.getState().clearAuth()
    throw new Error('Session expired')
  }
  return res
}

/** Generic fetch wrapper for custom backend API */
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, { headers: authHeaders(), ...options })
    handleUnauth(res)
    
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || `API Error: ${res.status} ${res.statusText}`)
    }

    const data = await res.json()
    
    // Backward compatibility for wrapped array responses
    if (Array.isArray(data)) {
      // If it's a 1-element array containing our expected object, unwrap it
      if (data.length === 1 && (data[0].total !== undefined || data[0].sheets !== undefined || data[0].data !== undefined)) {
        return data[0]
      }
      // If it's a multi-element array, it might be the list of sheets/data directly
      return data
    }
    
    return data
  } catch (err) {
    console.error(`Fetch Failure (${url}):`, err)
    demoMode = true
    throw err
  }
}

// ── Auth ──
export const login = (identifier, password) =>
  apiFetch(API.LOGIN, { method: 'POST', body: JSON.stringify({ identifier, password }) })

export const changePassword = (login_id, old_password, new_password) =>
  apiFetch(API.CHANGE_PASSWORD, { method: 'POST', body: JSON.stringify({ login_id, old_password, new_password }) })

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

export async function applyFilters(sheet, filters, page = 1, limit = 50) {
  return await apiFetch(API.APPLY_FILTERS, { method: 'POST', body: JSON.stringify({ sheet, filters, page, limit }) })
}

export async function addCandidate(sheet, candidate, added_by) {
  return await apiFetch(API.ADD_CANDIDATE, { method: 'POST', body: JSON.stringify({ sheet, candidate, added_by }) })
}

export async function editCandidate(sr_no, sheet, target_sheet, updated_fields, updated_by) {
  return await apiFetch(API.EDIT_CANDIDATE, { method: 'PUT', body: JSON.stringify({ sr_no, sheet, target_sheet, updated_fields, updated_by }) })
}

export async function removeCandidate(sr_no, sheet, removed_by) {
  return await apiFetch(API.REMOVE_CANDIDATE, { method: 'DELETE', body: JSON.stringify({ sr_no, sheet, removed_by }) })
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

export async function addSpreadsheet(spreadsheet_id, name) {
  return await apiFetch(API.SPREADSHEETS, { method: 'POST', body: JSON.stringify({ spreadsheet_id, name }) })
}

export async function removeSpreadsheet(spreadsheet_id) {
  return await apiFetch(`${API.SPREADSHEETS}/${encodeURIComponent(spreadsheet_id)}`, { method: 'DELETE' })
}

export async function syncSpreadsheet(spreadsheet_id) {
  return await apiFetch(`${API.SPREADSHEETS}/${encodeURIComponent(spreadsheet_id)}/sync`, { method: 'POST' })
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
  const token = useStore.getState().token
  const formData = new FormData()
  formData.append('file', file)
  formData.append('sheet', sheet)
  const res = await fetch(API.BULK_IMPORT, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })
  handleUnauth(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Import failed: ${res.status}`)
  }
  return res.json()
}

export async function importPreview(file) {
  const token = useStore.getState().token
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(API.IMPORT_PREVIEW, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })
  handleUnauth(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Preview failed: ${res.status}`)
  }
  return res.json()
}

export async function importValidate(file, mapping, sheet) {
  const token = useStore.getState().token
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mapping', JSON.stringify(mapping))
  formData.append('sheet', sheet)
  const res = await fetch(API.IMPORT_VALIDATE, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })
  handleUnauth(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Validation failed: ${res.status}`)
  }
  return res.json()
}

export async function importFinal(file, mapping, sheet) {
  const token = useStore.getState().token
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mapping', JSON.stringify(mapping))
  formData.append('sheet', sheet)
  const res = await fetch(API.IMPORT_CSV, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  })
  handleUnauth(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message || `Import failed: ${res.status}`)
  }
  return res.json()
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
