import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import useStore from '../lib/store'
import { getSheetSummary } from '../lib/api'
import { LayoutDashboard, Shield, LogOut, FileSpreadsheet, Upload, Database, ScrollText, Zap, KeyRound } from 'lucide-react'
import ChangePasswordModal from './ChangePasswordModal'

export default function Sidebar() {
  const { user, activeSheet, setActiveSheet, currentView, setView, clearAuth } = useStore()
  const [showChangePwd, setShowChangePwd] = useState(false)
  const rawRole = String(user?.role).toLowerCase().replace(/\s+/g, '_')
  const isSuperAdmin = rawRole === 'super_admin'
  const isAdmin = rawRole === 'admin' || isSuperAdmin

  const { data: summary } = useQuery({
    queryKey: ['sheet-summary', user?.login_id],
    queryFn: getSheetSummary,
    placeholderData: { sheets: [] },
  })

  // getSheetSummary already filters by grants for admin/user — use it directly
  const sheets = summary?.sheets?.length
    ? summary.sheets.map((s) => ({ name: s.name, count: s.count }))
    : []

  // Reset activeSheet when it's no longer in the accessible sheet list
  useEffect(() => {
    if (sheets.length > 0 && !sheets.find(s => s.name === activeSheet)) {
      setActiveSheet(sheets[0].name)
    } else if (sheets.length === 0) {
      setActiveSheet(null)
    }
  }, [JSON.stringify(sheets.map(s => s.name))])

  const navBtn = (view, icon, label, color = 'blue') =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
      currentView === view
        ? color === 'purple'
          ? 'bg-purple-50 text-purple-700 font-semibold'
          : color === 'amber'
          ? 'bg-amber-50 text-amber-700 font-semibold'
          : 'bg-blue-50 text-blue-700 font-semibold'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
    }`

  return (
    <nav className="w-[260px] bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-slate-100">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="text-base font-extrabold text-slate-800 tracking-tight">SheetSync</span>
          <span className="text-base font-extrabold text-blue-600 tracking-tight"> Pro</span>
        </div>
      </div>

      {/* Main nav */}
      <div className="px-3 pt-3 mb-1">
        <p className="px-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Navigation</p>

        <button onClick={() => setView('dashboard')} className={navBtn('dashboard', null, 'Dashboard')}>
          <LayoutDashboard className="w-[18px] h-[18px]" />Dashboard
        </button>

        {isAdmin && (
          <button onClick={() => setView('admin')} className={`mt-1 ${navBtn('admin', null, 'Admin Panel')}`}>
            <Shield className="w-[18px] h-[18px]" />Admin Panel
          </button>
        )}

        <button onClick={() => setView('import')} className={`mt-1 ${navBtn('import', null, 'Bulk Import')}`}>
          <Upload className="w-[18px] h-[18px]" />Bulk Import
        </button>

        {isSuperAdmin && (
          <button onClick={() => setView('spreadsheets')} className={`mt-1 ${navBtn('spreadsheets', null, 'Spreadsheets', 'purple')}`}>
            <Database className="w-[18px] h-[18px]" />Spreadsheets
          </button>
        )}

        {isAdmin && (
          <button onClick={() => setView('audit')} className={`mt-1 ${navBtn('audit', null, 'Audit Logs', 'amber')}`}>
            <ScrollText className="w-[18px] h-[18px]" />Audit Logs
          </button>
        )}
      </div>

      {/* Sheet tabs */}
      <div className="px-3 flex-1 overflow-y-auto pt-2">
        <p className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          Sheets {!isAdmin && sheets.length === 0 && <span className="text-red-400">(No Access)</span>}
        </p>
        {sheets.length === 0 && !isAdmin ? (
          <div className="px-3 py-4 text-xs text-slate-400 text-center">No sheets assigned.<br />Contact your admin.</div>
        ) : sheets.map((sheet) => (
          <button key={sheet.name} onClick={() => { setActiveSheet(sheet.name); setView('dashboard') }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all mb-0.5 ${activeSheet === sheet.name && currentView === 'dashboard' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-500 hover:bg-slate-50'}`}>
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1 text-left">{sheet.name}</span>
            {sheet.count > 0 && (
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">{sheet.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* User card */}
      <div className="p-3 border-t border-slate-100">
        {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
        <div className="flex items-center gap-2.5 bg-slate-50 rounded-xl p-2.5">
          <div className={`w-9 h-9 rounded-xl text-white flex items-center justify-center font-bold text-sm shrink-0 ${isSuperAdmin ? 'bg-gradient-to-br from-purple-600 to-indigo-600' : isAdmin ? 'bg-gradient-to-br from-blue-600 to-cyan-500' : 'bg-slate-500'}`}>
            {user?.name?.charAt(0) || user?.identifier?.charAt(0) || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-slate-800">{user?.name || user?.identifier || 'User'}</p>
            <p className={`text-[10px] uppercase font-bold tracking-wide ${isSuperAdmin ? 'text-purple-500' : isAdmin ? 'text-blue-500' : 'text-slate-400'}`}>
              {user?.display_role || user?.role || 'User'}
            </p>
          </div>
          <button onClick={() => setShowChangePwd(true)}
            className="w-8 h-8 rounded-lg bg-white text-slate-400 flex items-center justify-center hover:bg-blue-50 hover:text-blue-600 transition shrink-0 border border-slate-200"
            title="Change Password">
            <KeyRound className="w-4 h-4" />
          </button>
          <button onClick={async () => {
            const { logout } = await import('../lib/api');
            try { await logout() } catch {}
            clearAuth()
          }} className="w-8 h-8 rounded-lg bg-white text-red-400 flex items-center justify-center hover:bg-red-50 hover:text-red-600 transition shrink-0 border border-slate-200" title="Logout">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  )
}
