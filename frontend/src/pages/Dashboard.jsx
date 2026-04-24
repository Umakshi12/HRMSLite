import { useState } from 'react'
import useStore from '../lib/store'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import SearchBar from '../components/SearchBar'
import CandidateTable from '../components/CandidateTable'
import AdminPanel from '../components/AdminPanel'
import CandidateModal from '../components/CandidateModal'
import Watermark from '../components/Watermark'

export default function Dashboard() {
  const { currentView } = useStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const openAdd = () => { setEditData(null); setModalOpen(true) }
  const openEdit = (candidate) => { setEditData(candidate); setModalOpen(true) }

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {sidebarOpen && <Sidebar />}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar onAddCandidate={openAdd} toggleSidebar={() => setSidebarOpen(!sidebarOpen)} sidebarOpen={sidebarOpen} />

        {currentView === 'admin' ? (
          <div className="flex-1 overflow-y-auto p-6">
            <AdminPanel />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden p-4 space-y-3 flex flex-col">
            <SearchBar />
            {/* Filters are now inline on table column headers — no separate FilterBar needed */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
              <Watermark />
              <CandidateTable onEdit={openEdit} />
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <CandidateModal
          editData={editData}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
