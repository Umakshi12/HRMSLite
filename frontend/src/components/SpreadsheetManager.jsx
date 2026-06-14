import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSpreadsheets, addSpreadsheet, removeSpreadsheet,
  syncSpreadsheet, syncAllSpreadsheets, getSpreadsheetData, getUsers,
  getSheetGrants, updateSheetGrants, getServiceAccountEmail
} from '../lib/api'
import {
  Database, Plus, Trash2, CheckCircle, AlertCircle,
  RefreshCw, ExternalLink, DownloadCloud, Table, Users,
  Shield, Search, X, Copy, Info, Lock
} from 'lucide-react'
import { toast } from 'sonner'

export default function SpreadsheetManager() {
  const qc = useQueryClient()
  const [newId, setNewId] = useState('')
  const [testing, setTesting] = useState(false)
  const [activeSheetId, setActiveSheetId] = useState(null)
  const [activeTab, setActiveTab] = useState('data') // 'data' or 'access'
  const [activeDataTab, setActiveDataTab] = useState(null) // which Google Sheet tab is selected
  const [page, setPage] = useState(1)
  const [userSearch, setUserSearch] = useState('')
  const [togglingIds, setTogglingIds] = useState(new Set())
  const [syncingAll, setSyncingAll] = useState(false)
  const rowsPerPage = 100

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['spreadsheets'],
    queryFn: getSpreadsheets,
    placeholderData: [],
  })

  const { data: saData } = useQuery({
    queryKey: ['service-account-email'],
    queryFn: getServiceAccountEmail,
    staleTime: Infinity,
  })
  const serviceAccountEmail = saData?.email || null
  const spreadsheets = Array.isArray(data) ? data : []

  const { data: sheetData, isLoading: isSheetLoading } = useQuery({
    queryKey: ['spreadsheet-data', activeSheetId],
    queryFn: () => getSpreadsheetData(activeSheetId),
    enabled: !!activeSheetId && activeTab === 'data',
  })

  const { data: usersData, isLoading: isUsersLoading } = useQuery({
    queryKey: ['users-list'],
    queryFn: getUsers,
    enabled: !!activeSheetId && activeTab === 'access',
  })
  const allUsers = useMemo(() => {
    const list = Array.isArray(usersData) ? usersData : (usersData?.users || [])
    return list.filter(u => u.role !== 'super_admin') // super_admin always has full access
  }, [usersData])

  const { data: currentGrants, isLoading: isGrantsLoading } = useQuery({
    queryKey: ['sheet-grants', activeSheetId],
    queryFn: () => getSheetGrants(activeSheetId),
    enabled: !!activeSheetId && activeTab === 'access',
  })

  // Derive the set of user_ids that currently have access to this sheet
  const grantedUserIds = useMemo(() => {
    if (!currentGrants || !Array.isArray(currentGrants)) return new Set()
    return new Set(currentGrants.map(g => g.user_id))
  }, [currentGrants])

  // Toggle grant for a single user — fires immediately
  const handleToggle = async (userId) => {
    if (togglingIds.has(userId)) return
    const nowGranted = grantedUserIds.has(userId)
    const newGrantedIds = new Set(grantedUserIds)
    if (nowGranted) {
      newGrantedIds.delete(userId)
    } else {
      newGrantedIds.add(userId)
    }

    setTogglingIds(prev => new Set(prev).add(userId))
    try {
      await updateSheetGrants(activeSheetId, Array.from(newGrantedIds))
      qc.invalidateQueries(['sheet-grants', activeSheetId])
      toast.success(nowGranted ? 'Access revoked' : 'Access granted')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTogglingIds(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  const addMut = useMutation({
    mutationFn: () => addSpreadsheet(newId.trim()),
    onSuccess: (res) => {
      toast.success(`Added: ${res.title}`)
      qc.invalidateQueries(['spreadsheets'])
      qc.invalidateQueries(['sheet-summary'])
      setNewId('')
    },
    onError: (err) => toast.error(err.message),
  })

  const removeMut = useMutation({
    mutationFn: (id) => removeSpreadsheet(id),
    onSuccess: () => { toast.success('Spreadsheet disabled'); qc.invalidateQueries(['spreadsheets']); qc.invalidateQueries(['sheet-summary']) },
    onError: (err) => toast.error(err.message),
  })

  const syncMut = useMutation({
    mutationFn: (id) => syncSpreadsheet(id),
    onSuccess: (res, id) => {
      const totalSynced = res.results?.reduce((s, r) => s + (r.synced || 0), 0) ?? 0;
      toast.success(`Synced ${totalSynced} rows`);
      qc.invalidateQueries(['spreadsheets']);
      if (id === activeSheetId) qc.invalidateQueries(['spreadsheet-data', id])
    },
    onError: (err) => toast.error(err.message),
  })

  const testConnection = async () => {
    if (!newId.trim()) { toast.error('Enter a Spreadsheet ID first'); return }
    setTesting(true)
    try {
      const res = await addSpreadsheet(newId.trim())
      if (res.success) {
        toast.success(`Connected: ${res.title}`)
        qc.invalidateQueries(['spreadsheets'])
        setNewId('')
      } else {
        const errorMsg = String(res.message).toLowerCase();
        if (errorMsg.includes('403') || errorMsg.includes('permission') || errorMsg.includes('access')) {
          toast.error('Permission Denied: Please ensure the Service Account email is added as a "Viewer" to this Google Sheet.', { duration: 6000 });
        } else {
          toast.error(res.message)
        }
      }
    } catch (e) {
      const errorMsg = String(e.message).toLowerCase();
      if (errorMsg.includes('403') || errorMsg.includes('permission') || errorMsg.includes('access')) {
        toast.error('Permission Denied: Please ensure the Service Account email is added as a "Viewer" to this Google Sheet.', { duration: 6000 });
      } else {
        toast.error(e.message)
      }
    } finally { setTesting(false) }
  }

  const activeSheet = spreadsheets.find(ss => (ss.id || ss.sheet_id) === activeSheetId)

  // Resolve which tab's data to show in Data Preview
  const sheetTabs = sheetData?.tabs?.length ? sheetData.tabs : (
    sheetData?.headers?.length ? [{ name: 'Sheet', headers: sheetData.headers, data: sheetData.data }] : []
  )
  const currentDataTab = sheetTabs.find(t => t.name === activeDataTab) || sheetTabs[0] || null

  // Filtered and grouped users for access tab
  const { adminUsers, regularUsers } = useMemo(() => {
    const search = userSearch.toLowerCase()
    const filtered = allUsers.filter(u =>
      !search ||
      u.name?.toLowerCase().includes(search) ||
      u.login_id?.toLowerCase().includes(search) ||
      u.identifier?.toLowerCase().includes(search)
    )
    return {
      adminUsers: filtered.filter(u => u.role === 'admin'),
      regularUsers: filtered.filter(u => u.role === 'user'),
    }
  }, [allUsers, userSearch])

  const grantedCount = grantedUserIds.size

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Dynamic Spreadsheet Integration</h2>
          <p className="text-sm text-slate-400 mt-1">Connect spreadsheets. Data is automatically synced and cached for performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={async () => {
            try {
              setSyncingAll(true);
              await syncAllSpreadsheets();
              toast.success('Triggered sync for all active sheets');
              refetch();
            } catch (err) {
              toast.error('Sync all failed: ' + err.message);
            } finally {
              setSyncingAll(false);
            }
          }} disabled={syncingAll}
            className={`flex items-center gap-2 px-3 h-8 rounded-lg border text-xs font-bold transition ${syncingAll ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            title="Sync All Active Sheets">
            <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
            {syncingAll ? 'Syncing...' : 'Sync All'}
          </button>
          <button onClick={() => refetch()} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition" title="Refresh List">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Add new spreadsheet */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="font-semibold text-slate-700 flex items-center gap-2">
          <Plus className="w-4 h-4 text-blue-500" />Add New Spreadsheet
        </h3>

        {/* Service account helper banner */}
        {serviceAccountEmail && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs font-bold text-blue-700 flex items-center gap-1.5 mb-2">
              <Info className="w-3.5 h-3.5" />Step 1 — Share your Google Sheet first
            </p>
            <p className="text-xs text-blue-600 mb-2">
              Open your spreadsheet → <strong>Share</strong> → add this email as <strong>Editor</strong>:
            </p>
            <div className="flex items-center gap-2 bg-white border border-blue-200 rounded px-3 py-2">
              <code className="text-xs text-blue-800 flex-1 break-all">{serviceAccountEmail}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(serviceAccountEmail); toast.success('Copied!') }}
                className="shrink-0 text-blue-500 hover:text-blue-700 transition" title="Copy email">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-blue-500 mt-2">
              Then set "Anyone with the link" to <strong>Restricted</strong> — only this service account needs access.
            </p>
          </div>
        )}

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {serviceAccountEmail ? 'Step 2 — ' : ''}Spreadsheet ID *
            </label>
            <input value={newId} onChange={e => setNewId(e.target.value)}
              placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              className="field-input font-mono text-sm" />
            <p className="text-[11px] text-slate-400 mt-1">Found in the Google Sheets URL: /spreadsheets/d/<strong>ID</strong>/edit</p>
          </div>
          <button onClick={testConnection} disabled={testing || !newId.trim()}
            className="h-10 px-6 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold transition disabled:opacity-50 flex items-center justify-center gap-2">
            {testing ? 'Testing & Adding...' : 'Add Spreadsheet'}<Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Registered spreadsheets list */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-purple-500" />Connected Spreadsheets
          <span className="ml-auto text-xs bg-purple-50 text-purple-600 px-2.5 py-0.5 rounded-full font-bold">{spreadsheets.length}</span>
        </h3>

        {isLoading ? (
          <div className="space-y-3">{Array.from({length:3}).map((_,i) => <div key={i} className="h-16 skeleton rounded-lg" />)}</div>
        ) : spreadsheets.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <Database className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No additional spreadsheets connected.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {spreadsheets.map((ss) => (
              <div key={ss.id || ss.sheet_id} className={`flex items-center gap-4 p-4 rounded-xl border transition group ${(ss.is_active || ss.is_active === 'true') ? 'border-slate-200 bg-slate-50' : 'border-slate-100 bg-slate-50/50 opacity-60'}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${(ss.is_active || ss.is_active === 'true') ? 'bg-green-100' : 'bg-slate-100'}`}>
                  {(ss.is_active || ss.is_active === 'true') ? <CheckCircle className="w-5 h-5 text-green-600" /> : <AlertCircle className="w-5 h-5 text-slate-400" />}
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                  const sid = ss.id || ss.sheet_id;
                  if (activeSheetId === sid) {
                    setActiveSheetId(null);
                  } else {
                    setActiveSheetId(sid);
                    setActiveTab('data');
                    setActiveDataTab(null);
                    setPage(1);
                  }
                }}>
                  <p className="font-semibold text-slate-700 truncate">{ss.name || 'Untitled'} (Tab: {ss.tab_name})</p>
                  <p className="text-xs font-mono text-slate-400 truncate">{ss.sheet_id}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Synced: {ss.last_synced_at ? new Date(ss.last_synced_at).toLocaleString() : 'Never'} · {ss.columns?.length || 0} columns detected
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => {
                    const sid = ss.id || ss.sheet_id;
                    if (activeSheetId !== sid) {
                      setActiveSheetId(sid);
                      setActiveTab('data');
                      setActiveDataTab(null);
                      setPage(1);
                    } else if (activeTab === 'data') {
                      setActiveSheetId(null);
                    } else {
                      setActiveTab('data');
                    }
                  }}
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center transition ${activeSheetId === (ss.id || ss.sheet_id) && activeTab === 'data' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-slate-200 text-slate-400 hover:text-blue-500 hover:bg-blue-50'}`} title="View Data">
                    <Table className="w-4 h-4" />
                  </button>
                  <button onClick={() => {
                    const sid = ss.id || ss.sheet_id;
                    if (activeSheetId !== sid) {
                      setActiveSheetId(sid);
                      setActiveTab('access');
                      setActiveDataTab(null);
                      setPage(1);
                    } else if (activeTab === 'access') {
                      setActiveSheetId(null);
                    } else {
                      setActiveTab('access');
                    }
                  }}
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center transition ${activeSheetId === (ss.id || ss.sheet_id) && activeTab === 'access' ? 'bg-purple-50 border-purple-200 text-purple-600' : 'border-slate-200 text-slate-400 hover:text-purple-500 hover:bg-purple-50'}`} title="Manage Access">
                    <Users className="w-4 h-4" />
                  </button>
                  <button onClick={() => syncMut.mutate(ss.sheet_id)} disabled={syncMut.isPending}
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-green-500 hover:bg-green-50 transition" title="Sync Now">
                    <DownloadCloud className={`w-4 h-4 ${syncMut.isPending && syncMut.variables === ss.sheet_id ? 'animate-bounce text-green-500' : ''}`} />
                  </button>
                  <a href={`https://docs.google.com/spreadsheets/d/${ss.sheet_id}`} target="_blank" rel="noreferrer"
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition" title="Open in Sheets">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button onClick={() => { if (confirm('Disable this spreadsheet?')) removeMut.mutate(ss.sheet_id) }}
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-red-400 hover:bg-red-50 transition" title="Disable">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dynamic Data / Access View */}
      {activeSheetId && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div className="flex gap-4">
              <button onClick={() => setActiveTab('data')} className={`flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg transition ${activeTab === 'data' ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Table className="w-4 h-4" /> Data Preview
              </button>
              <button onClick={() => setActiveTab('access')} className={`flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg transition ${activeTab === 'access' ? 'bg-purple-100 text-purple-700' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Shield className="w-4 h-4" /> Access Control
              </button>
            </div>
            <button onClick={() => setActiveSheetId(null)} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center transition">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          <div className="p-0">
            {activeTab === 'data' ? (
              <div>
                {isSheetLoading ? (
                  <div className="p-8 text-center text-slate-400 animate-pulse">Loading data...</div>
                ) : sheetTabs.length === 0 ? (
                  <div className="p-8 text-center text-slate-400">No data found or sheet not synced yet. Click Sync Now.</div>
                ) : (
                  <>
                    {/* Tab switcher — only show when there are multiple tabs */}
                    {sheetTabs.length > 1 && (
                      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-slate-100 overflow-x-auto">
                        {sheetTabs.map(t => (
                          <button
                            key={t.name}
                            onClick={() => { setActiveDataTab(t.name); setPage(1); }}
                            className={`px-4 py-2 text-xs font-bold rounded-t-lg border-b-2 transition whitespace-nowrap ${
                              (currentDataTab?.name === t.name)
                                ? 'border-blue-500 text-blue-600 bg-blue-50'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {t.name}
                            <span className="ml-1.5 text-[10px] font-normal text-slate-400">({t.data.length})</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {currentDataTab && currentDataTab.data.length === 0 ? (
                      <div className="p-8 text-center text-slate-400">No rows in this tab yet. Sync to refresh.</div>
                    ) : currentDataTab ? (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-50 sticky top-0">
                              <tr>
                                {currentDataTab.headers.map((col, i) => (
                                  <th key={i} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100">
                                    {col.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {currentDataTab.data.slice((page - 1) * rowsPerPage, page * rowsPerPage).map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-slate-50/60 transition-colors">
                                  {currentDataTab.headers.map((col, cIdx) => {
                                    const val = String(row[col.key] ?? '');
                                    return (
                                      <td key={cIdx} className="px-4 py-2.5 text-slate-700">
                                        {val || <span className="text-slate-300">—</span>}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {currentDataTab.data.length > rowsPerPage && (
                          <div className="p-3 flex items-center justify-between border-t border-slate-100 bg-slate-50/50">
                            <span className="text-xs text-slate-500 font-medium">
                              Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, currentDataTab.data.length)} of {currentDataTab.data.length}
                            </span>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                className="px-3 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition cursor-pointer">
                                Previous
                              </button>
                              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(currentDataTab.data.length / rowsPerPage)}
                                className="px-3 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 disabled:opacity-50 hover:bg-slate-50 transition cursor-pointer">
                                Next
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              /* ── Access Control Panel ── */
              <div className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-slate-800 text-base">{activeSheet?.name} — Access Control</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Toggle access for each user. Changes take effect immediately.
                    </p>
                  </div>
                  {!isGrantsLoading && !isUsersLoading && (
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-extrabold text-slate-800">{grantedCount}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">
                        of {allUsers.length} have access
                      </p>
                    </div>
                  )}
                </div>

                {/* Super admin note */}
                <div className="flex items-center gap-2 bg-purple-50 border border-purple-100 rounded-lg px-4 py-2.5">
                  <Lock className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  <p className="text-xs text-purple-700">
                    <strong>Super Admins</strong> always have full access to all sheets and cannot be toggled.
                  </p>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    placeholder="Search by name or login ID..."
                    className="w-full h-10 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 focus:bg-white transition"
                  />
                  {userSearch && (
                    <button onClick={() => setUserSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {isUsersLoading || isGrantsLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-14 skeleton rounded-xl" />
                    ))}
                  </div>
                ) : allUsers.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No users found.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Admins section */}
                    {adminUsers.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
                          Admins ({adminUsers.length})
                        </p>
                        <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-50">
                          {adminUsers.map(u => (
                            <UserAccessRow
                              key={u.login_id}
                              user={u}
                              hasAccess={grantedUserIds.has(u.login_id)}
                              isToggling={togglingIds.has(u.login_id)}
                              onToggle={() => handleToggle(u.login_id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Users section */}
                    {regularUsers.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
                          Users ({regularUsers.length})
                        </p>
                        <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-50">
                          {regularUsers.map(u => (
                            <UserAccessRow
                              key={u.login_id}
                              user={u}
                              hasAccess={grantedUserIds.has(u.login_id)}
                              isToggling={togglingIds.has(u.login_id)}
                              onToggle={() => handleToggle(u.login_id)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {adminUsers.length === 0 && regularUsers.length === 0 && (
                      <div className="text-center py-8 text-slate-400 text-sm">
                        No users match your search.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700">
        <strong>Note:</strong> Make sure the Google Service Account email has <strong>Viewer or Editor</strong> access to any spreadsheet you add here.
      </div>
    </div>
  )
}

function UserAccessRow({ user, hasAccess, isToggling, onToggle }) {
  return (
    <div className={`flex items-center gap-4 px-4 py-3 transition-colors ${hasAccess ? 'bg-purple-50/40' : 'bg-white hover:bg-slate-50'}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
        user.role === 'admin' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
      }`}>
        {(user.name || user.identifier || 'U').charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{user.name || user.identifier}</p>
        <p className="text-[11px] text-slate-400 truncate">{user.login_id}</p>
      </div>

      {/* Role badge */}
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 ${
        user.role === 'admin' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
      }`}>
        {user.role}
      </span>

      {/* Toggle switch */}
      <button
        onClick={onToggle}
        disabled={isToggling}
        title={hasAccess ? 'Click to revoke access' : 'Click to grant access'}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
          hasAccess ? 'bg-purple-500' : 'bg-slate-200'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          hasAccess ? 'translate-x-6' : 'translate-x-1'
        } ${isToggling ? 'animate-pulse' : ''}`} />
      </button>
    </div>
  )
}
