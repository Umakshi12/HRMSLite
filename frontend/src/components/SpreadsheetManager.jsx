import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  getSpreadsheets, addSpreadsheet, removeSpreadsheet, 
  syncSpreadsheet, getSpreadsheetData, getUsers, 
  getSheetGrants, updateSheetGrants 
} from '../lib/api'
import { 
  Database, Plus, Trash2, CheckCircle, AlertCircle, 
  RefreshCw, ExternalLink, DownloadCloud, Table, Users, 
  Shield, Save, Search, X
} from 'lucide-react'
import { toast } from 'sonner'

export default function SpreadsheetManager() {
  const qc = useQueryClient()
  const [newId, setNewId] = useState('')
  const [testing, setTesting] = useState(false)
  const [activeSheetId, setActiveSheetId] = useState(null)
  const [activeTab, setActiveTab] = useState('data') // 'data' or 'access'
  const [page, setPage] = useState(1)
  const [userSearch, setUserSearch] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState([])
  const rowsPerPage = 100

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['spreadsheets'],
    queryFn: getSpreadsheets,
    placeholderData: [],
  })
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
  const allUsers = Array.isArray(usersData) ? usersData : (usersData?.users || [])

  const { data: currentGrants, isLoading: isGrantsLoading } = useQuery({
    queryKey: ['sheet-grants', activeSheetId],
    queryFn: () => getSheetGrants(activeSheetId),
    enabled: !!activeSheetId && activeTab === 'access',
  })

  // Sync selected users with current grants when tab opens
  useMemo(() => {
    if (currentGrants && Array.isArray(currentGrants)) {
      setSelectedUserIds(currentGrants.map(g => g.user_id || g['user id']));
    }
  }, [currentGrants]);

  const saveGrantsMut = useMutation({
    mutationFn: () => updateSheetGrants(activeSheetId, selectedUserIds),
    onSuccess: () => {
      toast.success('Access updated successfully');
      qc.invalidateQueries(['sheet-grants', activeSheetId]);
    },
    onError: (err) => toast.error(err.message),
  })

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
      toast.success(`Synced ${res.rows_synced} rows`); 
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

  const filteredUsers = allUsers.filter(u => 
    u.name?.toLowerCase().includes(userSearch.toLowerCase()) || 
    u.login_id?.toLowerCase().includes(userSearch.toLowerCase())
  ).filter(u => u.role === 'user'); // Granular access is only for users; admins see all.

  const toggleUser = (userId) => {
    setSelectedUserIds(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const activeSheet = spreadsheets.find(ss => (ss.id || ss.sheet_id) === activeSheetId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Dynamic Spreadsheet Integration</h2>
          <p className="text-sm text-slate-400 mt-1">Connect spreadsheets. Data is automatically synced and cached for performance.</p>
        </div>
        <button onClick={() => refetch()} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Add new spreadsheet */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-blue-500" />Add New Spreadsheet
        </h3>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Spreadsheet ID *</label>
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
                    } else if (activeTab === 'access') {
                      setActiveSheetId(null);
                    } else {
                      setActiveTab('access');
                    }
                  }}
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center transition ${activeSheetId === (ss.id || ss.sheet_id) && activeTab === 'access' ? 'bg-purple-50 border-purple-200 text-purple-600' : 'border-slate-200 text-slate-400 hover:text-purple-500 hover:bg-purple-50'}`} title="User Access">
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
                <Shield className="w-4 h-4" /> User Access
              </button>
            </div>
            <button onClick={() => setActiveSheetId(null)} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center transition">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          
          <div className="p-0">
            {activeTab === 'data' ? (
              <div className="overflow-x-auto">
                {isSheetLoading ? (
                  <div className="p-8 text-center text-slate-400 animate-pulse">Loading data...</div>
                ) : sheetData?.data?.length === 0 ? (
                  <div className="p-8 text-center text-slate-400">No data found or sheet not synced yet. Click Sync Now.</div>
                ) : (
                  <>
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-500 sticky top-0">
                        <tr>
                          {Object.keys(sheetData.data[0]).map((k, i) => (
                            <th key={i} className="px-4 py-3 font-semibold border-b border-slate-100">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-600">
                        {sheetData.data.slice((page - 1) * rowsPerPage, page * rowsPerPage).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50/50">
                            {Object.values(row).map((val, cIdx) => (
                              <td key={cIdx} className="px-4 py-2.5">{String(val || '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {sheetData?.data?.length > rowsPerPage && (
                      <div className="p-3 flex items-center justify-between border-t border-slate-100 bg-slate-50/50">
                        <span className="text-xs text-slate-500 font-medium">
                          Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, sheetData.data.length)} of {sheetData.data.length}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                            className="px-3 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 disabled:opacity-50 transition cursor-pointer hover:bg-slate-50">
                            Previous
                          </button>
                          <button onClick={() => setPage(page + 1)} disabled={page >= Math.ceil(sheetData.data.length / rowsPerPage)}
                            className="px-3 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 disabled:opacity-50 transition cursor-pointer hover:bg-slate-50">
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h4 className="font-bold text-slate-800">Manage Access for: {activeSheet?.name}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Selected users will be able to view and manage data in this sheet.</p>
                  </div>
                  <button onClick={() => saveGrantsMut.mutate()} disabled={saveGrantsMut.isPending}
                    className="h-9 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition disabled:opacity-50 flex items-center gap-2">
                    {saveGrantsMut.isPending ? 'Saving...' : 'Save Changes'}<Save className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative mb-4">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                    placeholder="Search users by name or ID..."
                    className="w-full h-10 pl-10 pr-4 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white transition" />
                </div>

                <div className="border border-slate-100 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto">
                  {isUsersLoading || isGrantsLoading ? (
                    <div className="p-12 text-center text-slate-400 animate-pulse">Loading users and permissions...</div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="p-12 text-center text-slate-400">No users found matching your search.</div>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 sticky top-0">
                        <tr>
                          <th className="px-4 py-3 font-semibold border-b border-slate-100 w-12">Grant</th>
                          <th className="px-4 py-3 font-semibold border-b border-slate-100">User Details</th>
                          <th className="px-4 py-3 font-semibold border-b border-slate-100">Role</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredUsers.map(u => (
                          <tr key={u.login_id} className={`hover:bg-slate-50 transition cursor-pointer ${selectedUserIds.includes(u.login_id) ? 'bg-blue-50/30' : ''}`} onClick={() => toggleUser(u.login_id)}>
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={selectedUserIds.includes(u.login_id)} onChange={() => {}} 
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-700">{u.name}</p>
                              <p className="text-xs text-slate-400">{u.login_id}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-wider">{u.role}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
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
