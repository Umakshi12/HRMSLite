import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import useStore from '../lib/store'
import { getSheetSummary } from '../lib/api'
import { getSheets } from '../lib/mockData'
import { LayoutDashboard, Shield, LogOut, Users, FileSpreadsheet, Upload, Database } from 'lucide-react'

export default function Sidebar() {
  const { user, activeSheet, setActiveSheet, currentView, setView, clearAuth } = useStore()
  const rawRole = String(user?.role).toLowerCase().replace(/\s+/g, '_')
  const isSuperAdmin = rawRole === 'super_admin'
  const isAdmin = rawRole === 'admin' || isSuperAdmin

  const { data: summary } = useQuery({
    queryKey: ['sheet-summary'],
    queryFn: getSheetSummary,
    placeholderData: { sheets: [] },
  })

  const allSheets = summary?.sheets?.length
    ? summary.sheets.map((s) => ({ name: s.name, count: s.count }))
    : getSheets().map((name) => ({ name, count: 0 }))

  // Filter sheets by user access (admins see all)
  const sheets = (() => {
    if (isAdmin) return allSheets
    const access = user?.sheet_access || []
    if (!access.length || access.includes('All') || access.includes('all')) return allSheets
    return allSheets.filter(s => access.map(a => a.toLowerCase()).includes(s.name.toLowerCase()))
  })()

  useEffect(() => {
    if (sheets.length && !sheets.find((s) => s.name === activeSheet)) {
      setActiveSheet(sheets[0]?.name)
    }
  }, [sheets.length])

  return (
    <nav className="w-[260px] bg-white border-r border-slate-200 flex flex-col shrink-0">
      <div className="px-5 py-5 flex items-center gap-3">
        <Users className="w-6 h-6 text-blue-600" />
        <span className="text-xl font-extrabold text-slate-800">Staffurs</span>
      </div>

      <div className="px-3 mb-2">
        <p className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Main</p>
        <button onClick={() => setView('dashboard')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${currentView === 'dashboard' ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-500 hover:bg-slate-50'}`}>
          <LayoutDashboard className="w-[18px] h-[18px]" />Dashboard
        </button>

        {isAdmin && (
          <button onClick={() => setView('admin')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mt-1 ${currentView === 'admin' ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Shield className="w-[18px] h-[18px]" />Admin Panel
          </button>
        )}

        {isAdmin && (
          <button onClick={() => setView('import')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mt-1 ${currentView === 'import' ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Upload className="w-[18px] h-[18px]" />Bulk Import
          </button>
        )}

        {isSuperAdmin && (
          <button onClick={() => setView('spreadsheets')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition mt-1 ${currentView === 'spreadsheets' ? 'bg-purple-50 text-purple-600 font-semibold' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Database className="w-[18px] h-[18px]" />Spreadsheets
          </button>
        )}
      </div>

      <div className="px-3 flex-1 overflow-y-auto">
        <p className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Categories {!isAdmin && sheets.length === 0 && <span className="text-red-400">(No Access)</span>}
        </p>
        {sheets.length === 0 && !isAdmin ? (
          <div className="px-3 py-4 text-xs text-slate-400 text-center">No sheets assigned.<br />Contact your admin.</div>
        ) : sheets.map((sheet) => (
          <button key={sheet.name} onClick={() => { setActiveSheet(sheet.name); setView('dashboard') }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition mb-0.5 ${activeSheet === sheet.name && currentView === 'dashboard' ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-500 hover:bg-slate-50'}`}>
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1 text-left">{sheet.name}</span>
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-slate-100">
        <div className="flex items-center gap-2.5 bg-slate-50 rounded-xl p-2.5">
          <div className={`w-9 h-9 rounded-xl text-white flex items-center justify-center font-bold text-sm shrink-0 ${isSuperAdmin ? 'bg-purple-600' : isAdmin ? 'bg-blue-600' : 'bg-slate-500'}`}>
            {user?.name?.charAt(0) || user?.identifier?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{user?.name || user?.identifier || 'User'}</p>
            <p className={`text-[11px] uppercase font-semibold ${isSuperAdmin ? 'text-purple-500' : isAdmin ? 'text-blue-500' : 'text-slate-400'}`}>
              {user?.display_role || user?.role || 'User'}
            </p>
          </div>
          <button onClick={clearAuth} className="w-8 h-8 rounded-lg bg-white text-red-500 flex items-center justify-center hover:bg-red-50 transition shrink-0" title="Logout">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  )
}
