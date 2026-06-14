import { useMemo, useCallback, useEffect, useState, useRef } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender } from '@tanstack/react-table'
import useStore from '../lib/store'
import { applyFilters, removeCandidate, getFilterOptions, getSpreadsheets, syncSpreadsheet } from '../lib/api'
import { API_BASE } from '../lib/config'
import { Pencil, ArrowUpDown, ChevronLeft, ChevronRight, RefreshCw, Trash2, Filter, X, Eye, FileUp, Phone, MessageCircle, Download } from 'lucide-react'
import { toast } from 'sonner'
import CSVImportWizard from './CSVImportWizard'

const PAGE_SIZE = 100

// ── Description Popup ──
function DescriptionPopup({ text, onClose }) {
  if (!text) return null
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-700">Full Description</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
          {text || '—'}
        </div>
      </div>
    </div>
  )
}

// ── Inline Header Filter Dropdown ──
function HeaderFilter({ column, label, options, activeFilters, onFilterChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)
  const currentValues = activeFilters[column] || []
  const isActive = currentValues.length > 0

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))

  const toggle = (val) => {
    const next = currentValues.includes(val)
      ? currentValues.filter(v => v !== val)
      : [...currentValues, val]
    onFilterChange(column, next)
  }

  const clearThis = () => onFilterChange(column, [])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={`ml-1 w-4 h-4 rounded flex items-center justify-center transition ${isActive ? 'text-blue-600 bg-blue-100' : 'text-slate-300 hover:text-slate-500'}`}
        title={`Filter ${label}`}
      >
        <Filter className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 w-52 max-h-72 flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label}...`}
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded outline-none focus:border-blue-400"
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 p-2 text-center">No options</p>
            ) : filtered.map(opt => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={currentValues.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-blue-600 w-3.5 h-3.5"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
          {isActive && (
            <div className="p-2 border-t border-slate-100">
              <button onClick={clearThis} className="text-xs text-red-500 hover:underline cursor-pointer w-full text-center">
                Clear filter ({currentValues.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Filterable columns config ──
const FILTERABLE = {
  state: 'State',
  gender: 'Gender',
  marital_status: 'Marital Status',
  timing: 'Timing',
  experience: 'Exp.',
  education: 'Education',
  verification: 'Verification',
  area: 'Area',
  added_by: 'Modified By',
}

// ── Column Priority Map ──
const COLUMN_PRIORITY = {
  sr_no: 1,
  name: 2,
  mobile: 3,
  area: 4,
  experience: 5,
  salary: 6,
  verification: 7,
  education: 8,
  gender: 9,
  age: 10,
  dob: 11,
  address: 12,
  state: 13,
  marital_status: 14,
  timing: 15,
  since: 16,
  added_by: 17,
  last_updated: 18,
  last_message: 19,
  description: 20
};

const getColPriority = (key) => COLUMN_PRIORITY[key] || 999;


export default function CandidateTable({ onEdit }) {
  const { user, token, activeSheet, searchQuery, searchAllSheets, filters, setFilters } = useStore()
  const [sorting, setSorting] = useState([{ id: 'last_updated', desc: true }])
  const [page, setPage] = useState(1)
  const [activeTab, setActiveTab] = useState(null)
  const [descPopup, setDescPopup] = useState(null)
  const [showImportWizard, setShowImportWizard] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const qc = useQueryClient()

  // Fetch filter options for inline dropdowns
  const { data: filterOptions } = useQuery({
    queryKey: ['filter-options', activeSheet],
    queryFn: () => getFilterOptions(activeSheet),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch dynamic spreadsheets registry
  const { data: spreadsheets } = useQuery({
    queryKey: ['spreadsheets'],
    queryFn: getSpreadsheets,
    placeholderData: [],
  })

  const removeMut = useMutation({
    mutationFn: (data) => removeCandidate(data.sr_no, data.row_index, data.sheet, data.user),
    onSuccess: () => {
      toast.success('Candidate removed successfully')
      qc.invalidateQueries({ queryKey: ['sheet-data'] })
      qc.invalidateQueries({ queryKey: ['sheet-summary'] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
    },
    onError: (err) => toast.error(`Failed to remove: ${err.message}`)
  })

  // Reset tab and page when sheet changes
  useEffect(() => { setActiveTab(null); setPage(1) }, [activeSheet])
  useEffect(() => { setPage(1) }, [searchAllSheets, searchQuery, JSON.stringify(filters), activeTab])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['sheet-data', activeSheet, searchAllSheets, searchQuery, filters, page, activeTab],
    queryFn: () => {
      const targetSheet = searchAllSheets ? 'all' : activeSheet
      const payloadFilters = {
        ...filters,
        ...(searchQuery?.trim() ? { search: searchQuery.trim() } : {}),
      }
      return applyFilters(targetSheet, payloadFilters, page, PAGE_SIZE, searchAllSheets ? null : activeTab)
    },
    placeholderData: (prev) => prev,
    staleTime: 2 * 60 * 1000,
  })

  const rows = data?.data || []
  const total = data?.total || 0

  // Handle inline filter changes
  const handleFilterChange = useCallback((column, values) => {
    if (values.length === 0) {
      const next = { ...filters }
      delete next[column]
      setFilters(next)
    } else {
      setFilters({ ...filters, [column]: values })
    }
  }, [filters, setFilters])

  const activeFilterCount = Object.values(filters).filter(v => Array.isArray(v) ? v.length : v).length

  const dynamicSheet = useMemo(() => {
    if (!spreadsheets || searchAllSheets) return null;
    return spreadsheets.find(s => s.name === activeSheet && s.is_active);
  }, [spreadsheets, activeSheet, searchAllSheets]);

  // Tabs for this spreadsheet (only shown when > 1 tab)
  const sheetTabs = useMemo(() => {
    if (!dynamicSheet?.tabs || dynamicSheet.tabs.length <= 1) return [];
    return dynamicSheet.tabs.filter(t => !t.deleted_at);
  }, [dynamicSheet]);

  // Effective active tab name (null = show all)
  const effectiveTab = searchAllSheets ? null : activeTab;

  // Columns for the currently-active tab
  const activeTabColumns = useMemo(() => {
    if (!effectiveTab || !dynamicSheet?.tabs) return null;
    const tab = dynamicSheet.tabs.find(t => t.tab_name === effectiveTab);
    if (!tab?.headers?.length) return null;
    return [...tab.headers].sort((a, b) => a.index - b.index).map(h => h.name || `Col ${h.index + 1}`);
  }, [effectiveTab, dynamicSheet]);

  const handleRefresh = async () => {
    if (dynamicSheet) {
      try {
        setSyncing(true);
        const res = await syncSpreadsheet(dynamicSheet.sheet_id);
        const totalSynced = res.results?.reduce((s, r) => s + (r.synced || 0), 0) ?? 0;
        toast.success(`Synced ${totalSynced} rows from Google Sheets`);
      } catch (err) {
        toast.error('Sync failed: ' + err.message);
      } finally {
        setSyncing(false);
      }
    }
    qc.invalidateQueries({ queryKey: ['sheet-data'] });
  };

  const handleExport = async () => {
    try {
      const targetSheet = searchAllSheets ? 'all' : activeSheet
      const url = `${API_BASE}/export-sheet?sheet=${targetSheet}&all=${searchAllSheets}`
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.message || 'Export failed')
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `${targetSheet === 'all' ? 'All_Candidates' : targetSheet}_Export_${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(downloadUrl)
      toast.success('Export downloaded successfully')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const columns = useMemo(() => {
    let baseHeaders = [];
    if (activeTabColumns && activeTabColumns.length > 0) {
      baseHeaders = activeTabColumns;
    } else if (dynamicSheet && dynamicSheet.columns && dynamicSheet.columns.length > 0) {
      baseHeaders = dynamicSheet.columns.map(c => c.name || c);
    } else if (rows && rows.length > 0) {
      // Auto-detect from data keys
      baseHeaders = Object.keys(rows[0]).filter(k => !['_sheet', 'id', 'spreadsheet_id', 'row_index', 'search_vector'].includes(k));
    } else {
      // Fallback
      baseHeaders = ['Sr.', 'Name', 'Mobile No', 'Address', 'State', 'Area', 'Experience', 'Education', 'DOB', 'Age', 'Gender', 'Salary', 'Verification', 'Description', 'Since', 'Added By', 'Last Updated'];
    }

    const normalizeHeader = (h) => String(h || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const seenKeys = new Set();

    const generatedCols = baseHeaders.map((headerName, index) => {
      let accessorKey = normalizeHeader(headerName);
      if (!accessorKey) accessorKey = `col_${index + 1}`;
      
      let uniqueKey = accessorKey;
      let counter = 1;
      while (seenKeys.has(uniqueKey)) {
        uniqueKey = `${accessorKey}_${counter}`;
        counter++;
      }
      seenKeys.add(uniqueKey);
      
      const colName = uniqueKey;
      let size = 120;
      
      let cellRender = ({ getValue }) => {
        const v = getValue();
        if (v === undefined || v === null || v === '') return <span className="text-slate-300">—</span>;
        const strVal = String(v);

        const isEmailCol = colName.includes('email');
        const isEmailData = strVal.includes('@') && strVal.includes('.') && !strVal.includes(' ');

        if (isEmailCol || isEmailData) {
          return (
            <div className="flex items-center gap-2">
              <span className="truncate max-w-[150px]">{strVal}</span>
              <a href={`mailto:${strVal}`} className="w-6 h-6 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all flex-shrink-0" title={`Email ${strVal}`} onClick={(e) => e.stopPropagation()}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
              </a>
            </div>
          );
        }

        const cleanNum = String(strVal).replace(/\D/g, '');
        const isPhoneCol = colName.includes('mobile') || colName.includes('phone') || colName.includes('contact');
        const isPhoneData = cleanNum.length >= 10 && cleanNum.length <= 13 && !colName.includes('salary') && !colName.includes('sr') && !colName.includes('id') && !colName.includes('pin') && !colName.includes('date');

        if (isPhoneCol || (isPhoneData && (strVal.startsWith('+') || cleanNum.length === 10 || cleanNum.length === 12))) {
          const num = strVal;
          const waNum = cleanNum.length === 10 ? '91' + cleanNum : cleanNum;
          return (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-600 min-w-[80px]">{num}</span>
              <div className="flex items-center gap-1.5 transition-opacity flex-shrink-0">
                <a href={`tel:${cleanNum}`} className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all duration-200" title={`Call ${num}`} onClick={(e) => e.stopPropagation()}>
                  <Phone className="w-3 h-3" />
                </a>
                <a href={`https://wa.me/${waNum}`} target="_blank" rel="noopener noreferrer" className="w-6 h-6 rounded-lg bg-green-50 text-green-600 flex items-center justify-center hover:bg-green-600 hover:text-white transition-all duration-200" title={`WhatsApp ${num}`} onClick={(e) => e.stopPropagation()}>
                  <MessageCircle className="w-3 h-3" />
                </a>
              </div>
            </div>
          );
        }

        if (colName.includes('description') || colName.includes('note') || colName.includes('remark') || colName.includes('detail') || colName.includes('message')) {
          return (
            <div className="flex items-center gap-1">
              <div className="truncate max-w-[160px]" title={strVal}>{strVal}</div>
              <button onClick={(e) => { e.stopPropagation(); setDescPopup(strVal); }} className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition cursor-pointer flex-shrink-0" title="View full text">
                <Eye className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }

        if (colName === 'verification' || colName === 'status') {
          const cls = strVal.toLowerCase() === 'verified' ? 'bg-green-50 text-green-600' : strVal.toLowerCase() === 'pending' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500';
          return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${cls}`}>{strVal}</span>;
        }

        if (colName.includes('salary')) {
          return strVal === '0' || strVal === '' ? '—' : `₹${Number(strVal.replace(/\D/g, '')).toLocaleString()}`;
        }
        
        // General fallback for long strings (like address)
        if (strVal.length > 40) {
          return (
            <div className="flex items-center gap-1">
              <div className="truncate max-w-[160px]" title={strVal}>{strVal}</div>
              <button onClick={(e) => { e.stopPropagation(); setDescPopup(strVal); }} className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition cursor-pointer flex-shrink-0" title="View full text">
                <Eye className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }

        return <span className="truncate max-w-[200px] inline-block">{strVal}</span>;
      };

      if (accessorKey === 'sr_no' || accessorKey === 'sr') size = 50;
      else if (accessorKey.includes('description') || accessorKey.includes('message')) size = 200;
      else if (accessorKey.includes('mobile')) size = 150;
      else if (accessorKey.includes('address')) size = 140;
      else if (accessorKey.includes('added_by')) size = 150;
      else if (accessorKey.includes('last_updated')) size = 130;

      return {
        accessorKey: uniqueKey,
        header: headerName,
        size,
        cell: cellRender,
        meta: (uniqueKey === 'sr_no' || uniqueKey.includes('salary')) ? { className: 'font-mono' } : undefined
      };
    });

    // Ensure columns are ordered by priority
    generatedCols.sort((a, b) => getColPriority(a.accessorKey) - getColPriority(b.accessorKey));

    return [
      ...generatedCols,
      {
        id: 'actions',
        header: '',
        size: 80,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(row.original) }}
              className="w-7 h-7 rounded-lg hover:bg-blue-50 flex items-center justify-center text-blue-500 transition cursor-pointer"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Are you sure you want to remove ${row.original.name || 'this record'}?`)) {
                  removeMut.mutate({ sr_no: row.original.sr_no || row.original.sr, row_index: row.original.row_index, sheet: activeSheet || row.original.sheet || row.original._sheet, user: 'System' })
                }
              }}
              disabled={removeMut.isPending}
              className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-red-500 transition cursor-pointer disabled:opacity-50"
              title="Remove"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      },
    ];
  }, [dynamicSheet, activeTabColumns, rows, removeMut, activeSheet, onEdit]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  // Anti-copy
  const handleContextMenu = useCallback((e) => { e.preventDefault() }, [])
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['c', 'a', 's'].includes(e.key)) e.preventDefault()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden anti-copy h-full flex flex-col" onContextMenu={handleContextMenu}>
      {/* Tab Switcher — only shown for multi-tab spreadsheets */}
      {sheetTabs.length > 0 && !searchAllSheets && (
        <div className="px-4 pt-3 pb-0 flex items-center gap-1 border-b border-slate-100 overflow-x-auto">
          <button
            onClick={() => setActiveTab(null)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition whitespace-nowrap cursor-pointer ${
              effectiveTab === null
                ? 'border-blue-500 text-blue-600 bg-blue-50/60'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            All Tabs
          </button>
          {sheetTabs.map(tab => (
            <button
              key={tab.tab_name}
              onClick={() => setActiveTab(tab.tab_name)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition whitespace-nowrap cursor-pointer ${
                effectiveTab === tab.tab_name
                  ? 'border-blue-500 text-blue-600 bg-blue-50/60'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.tab_name}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-500 font-medium">
            Showing <strong className="text-slate-700">{rows.length}</strong> of <strong className="text-slate-700">{total}</strong> records
            {effectiveTab && <span className="ml-1 text-blue-500 font-semibold">· {effectiveTab}</span>}
          </p>
          {(isFetching || syncing) && <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters({})}
              className="text-xs text-red-500 hover:underline cursor-pointer flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-500 font-medium px-2">
            Page {page}{totalPages > 1 ? ` / ${totalPages}` : ''}
          </span>
          <button onClick={() => setPage(page + 1)} disabled={page >= totalPages}
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={handleRefresh} disabled={syncing}
            className={`ml-2 w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center transition cursor-pointer ${syncing ? 'bg-blue-50 text-blue-500 border-blue-200' : 'hover:bg-blue-50 text-slate-400 hover:text-blue-500'}`}
            title="Sync & Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          </button>
          {user && ['admin', 'super_admin'].includes(String(user.role).toLowerCase().replace(/\s+/g, '_')) && (
            <button
              onClick={handleExport}
              className="ml-1 px-3 h-8 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-1.5 hover:bg-slate-50 transition cursor-pointer text-xs font-semibold"
              title="Export CSV"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          )}
          <button
            onClick={() => setShowImportWizard(true)}
            className="ml-1 px-3 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center gap-1.5 hover:bg-blue-700 transition cursor-pointer text-xs font-bold shadow-sm shadow-blue-100"
            title="Import CSV"
          >
            <FileUp className="w-3.5 h-3.5" />
            Import CSV
          </button>
        </div>
      </div>

      {/* Active Filter Pills */}
      {activeFilterCount > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-1.5 bg-blue-50/30">
          {Object.entries(filters).map(([key, val]) => {
            const display = Array.isArray(val) ? val.join(', ') : val
            if (!display) return null
            const labelName = FILTERABLE[key] || (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '))
            return (
              <span key={key} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full text-[11px] font-semibold">
                {labelName}: {display}
                <button onClick={() => handleFilterChange(key, [])} className="cursor-pointer"><X className="w-3 h-3" /></button>
              </span>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto flex-1 min-h-0">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-10 skeleton rounded" style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-slate-400 text-sm mb-1">No candidates found</p>
            <p className="text-slate-300 text-xs">Try adjusting your search or filters</p>
          </div>
        ) : (
          <table className="w-full border-collapse min-w-[1400px]">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const colKey = header.column.columnDef.accessorKey
                    const opts = filterOptions?.[colKey] || []
                    const isFilterable = colKey && (FILTERABLE[colKey] || opts.length > 0)
                    const labelName = FILTERABLE[colKey] || (typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : colKey)
                    return (
                      <th key={header.id} className="excel-th" style={{ width: header.getSize() }}>
                        <span className="flex items-center gap-0.5">
                          <span
                            className="flex items-center gap-1 cursor-pointer flex-1"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              <ArrowUpDown className={`w-3 h-3 ${header.column.getIsSorted() ? 'text-blue-500 opacity-100' : 'opacity-30'}`} />
                            )}
                          </span>
                          {(isFilterable && opts.length > 0) && (
                            <HeaderFilter
                              column={colKey}
                              label={labelName}
                              options={opts}
                              activeFilters={filters}
                              onFilterChange={handleFilterChange}
                            />
                          )}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="excel-row">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={`excel-td ${cell.column.columnDef.meta?.className || ''}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Description Popup */}
      {descPopup && <DescriptionPopup text={descPopup} onClose={() => setDescPopup(null)} />}

      {/* CSV Import Wizard */}
      {showImportWizard && <CSVImportWizard onClose={() => setShowImportWizard(false)} />}
    </div>
  )
}
