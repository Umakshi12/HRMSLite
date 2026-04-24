import useStore from '../lib/store'
import { Plus, Bell, PanelLeftClose, PanelLeft } from 'lucide-react'

export default function TopBar({ onAddCandidate, toggleSidebar, sidebarOpen }) {
  const { currentView, activeSheet } = useStore()

  const title = currentView === 'admin' ? 'Access Control' : activeSheet

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <button 
          onClick={toggleSidebar} 
          className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 transition cursor-pointer"
          title="Toggle Sidebar"
        >
          {sidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeft className="w-5 h-5" />}
        </button>
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
      </div>

      <div className="flex items-center gap-3">
        {currentView !== 'admin' && (
          <button
            onClick={onAddCandidate}
            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Candidate
          </button>
        )}
        <button className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 transition cursor-pointer">
          <Bell className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  )
}
