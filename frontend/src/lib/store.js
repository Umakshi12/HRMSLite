import { create } from 'zustand'

const useStore = create((set, get) => ({
  // ── Auth ──
  user: null,
  token: null,
  setAuth: (user, token) => set({ user, token }),
  clearAuth: () => {
    set({ user: null, token: null })
    sessionStorage.removeItem('staffurs_token')
    sessionStorage.removeItem('staffurs_user')
  },

  // ── Active Sheet ──
  activeSheet: 'Japa',
  setActiveSheet: (sheet) => set({ activeSheet: sheet }),

  // ── Search ──
  searchQuery: '',
  searchAllSheets: false,
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchAllSheets: (v) => set({ searchAllSheets: v }),

  // ── Filters ──
  filters: {},
  setFilters: (filters) => set({ filters }),
  clearFilters: () => set({ filters: {} }),

  // ── UI ──
  currentView: 'dashboard',
  setView: (v) => set({ currentView: v }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // ── Column Preferences (persisted) ──
  columnVisibility: JSON.parse(localStorage.getItem('staffurs_cols') || '{}'),
  setColumnVisibility: (vis) => {
    localStorage.setItem('staffurs_cols', JSON.stringify(vis))
    set({ columnVisibility: vis })
  },
}))

export default useStore
