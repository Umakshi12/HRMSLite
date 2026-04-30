import { useState } from 'react'
import useStore from '../lib/store'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import SearchBar from '../components/SearchBar'
import CandidateTable from '../components/CandidateTable'
import AdminPanel from '../components/AdminPanel'
import BulkImportPage from '../components/BulkImportPage'
import SpreadsheetManager from '../components/SpreadsheetManager'
import CandidateModal from '../components/CandidateModal'
import Watermark from '../components/Watermark'

export default function Dashboard() {
  const { currentView, user } = useStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [editData, setEditData] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const rawRole = String(user?.role).toLowerCase().replace(/\s+/g, '_')
  const isSuperAdmin = rawRole === 'super_admin'
  const isAdmin = rawRole === 'admin' || isSuperAdmin

  const openAdd = () => { setEditData(null); setModalOpen(true) }
  const openEdit = (candidate) => { setEditData(candidate); setModalOpen(true) }

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {sidebarOpen && <Sidebar />}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar onAddCandidate={openAdd} toggleSidebar={() => setSidebarOpen(!sidebarOpen)} sidebarOpen={sidebarOpen} />

        {currentView === 'admin' && isAdmin ? (
          <div className="flex-1 overflow-y-auto p-6">
            <AdminPanel />
          </div>
        ) : currentView === 'import' && isAdmin ? (
          <div className="flex-1 overflow-y-auto p-6">
            <BulkImportPage />
          </div>
        ) : currentView === 'spreadsheets' && isSuperAdmin ? (
          <div className="flex-1 overflow-y-auto p-6">
            <SpreadsheetManager />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden p-4 space-y-3 flex flex-col">
            <SearchBar />
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
