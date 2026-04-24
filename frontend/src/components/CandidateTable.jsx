import { useMemo, useCallback, useEffect, useState, useRef } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender } from '@tanstack/react-table'
import useStore from '../lib/store'
import { applyFilters, removeCandidate, getFilterOptions } from '../lib/api'
import { Pencil, ArrowUpDown, ChevronLeft, ChevronRight, RefreshCw, Trash2, Filter, X, Eye } from 'lucide-react'
import { toast } from 'sonner'

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
}

export default function CandidateTable({ onEdit }) {
  const { activeSheet, searchQuery, searchAllSheets, filters, setFilters } = useStore()
  const [sorting, setSorting] = useState([])
  const [page, setPage] = useState(1)
  const [descPopup, setDescPopup] = useState(null)
  const qc = useQueryClient()

  // Fetch filter options for inline dropdowns
  const { data: filterOptions } = useQuery({
    queryKey: ['filter-options', activeSheet],
    queryFn: () => getFilterOptions(activeSheet),
    staleTime: 5 * 60 * 1000,
  })

  const removeMut = useMutation({
    mutationFn: (data) => removeCandidate(data.sr_no, data.sheet, data.user),
    onSuccess: () => {
      toast.success('Candidate removed successfully')
      qc.invalidateQueries({ queryKey: ['sheet-data'] })
      qc.invalidateQueries({ queryKey: ['sheet-summary'] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
    },
    onError: (err) => toast.error(`Failed to remove: ${err.message}`)
  })

  useEffect(() => { setPage(1) }, [activeSheet, searchAllSheets, searchQuery, JSON.stringify(filters)])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['sheet-data', activeSheet, searchAllSheets, searchQuery, filters, page],
    queryFn: () => {
      const targetSheet = searchAllSheets ? 'all' : activeSheet
      const payloadFilters = {
        ...filters,
        ...(searchQuery?.trim() ? { search: searchQuery.trim() } : {}),
      }
      return applyFilters(targetSheet, payloadFilters, page, PAGE_SIZE)
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

  const COLUMNS = useMemo(() => [
    { accessorKey: 'sr_no', header: 'Sr.', size: 50, meta: { className: 'font-mono text-xs text-slate-400 text-center' } },
    { accessorKey: 'name', header: 'Name', size: 150, meta: { className: 'font-semibold' } },
    { accessorKey: 'address', header: 'Address', size: 140 },
    { accessorKey: 'state', header: 'State', size: 90 },
    { accessorKey: 'marital_status', header: 'Marital Status', size: 100 },
    { accessorKey: 'timing', header: 'Timing', size: 85 },
    { accessorKey: 'area', header: 'Area', size: 100 },
    { accessorKey: 'experience', header: 'Exp.', size: 95 },
    { accessorKey: 'education', header: 'Education', size: 105 },
    { accessorKey: 'dob', header: 'DOB', size: 90, meta: { className: 'font-mono text-xs' } },
    { accessorKey: 'age', header: 'Age', size: 50, meta: { className: 'font-mono text-center' } },
    { accessorKey: 'gender', header: 'Gender', size: 75, cell: ({ getValue }) => <span className="capitalize">{getValue()}</span> },
    { accessorKey: 'salary', header: 'Salary ₹', size: 85, cell: ({ getValue }) => { const v = getValue(); return v === 0 || !v ? '—' : `₹${Number(v).toLocaleString()}` }, meta: { className: 'font-mono' } },
    { accessorKey: 'mobile', header: 'Mobile No', size: 110, meta: { className: 'font-mono text-xs' } },
    { accessorKey: 'verification', header: 'Verification', size: 95, cell: ({ getValue }) => {
      const v = getValue()
      const cls = v === 'verified' ? 'bg-green-50 text-green-600' : v === 'pending' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'
      return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${cls}`}>{v}</span>
    }},
    {
      accessorKey: 'description',
      header: 'Description',
      size: 200,
      cell: ({ getValue }) => {
        const val = getValue()
        if (!val) return <span className="text-slate-300">—</span>
        return (
          <div className="flex items-center gap-1 group">
            <div className="truncate max-w-[160px]" title={val}>{val}</div>
            <button
              onClick={(e) => { e.stopPropagation(); setDescPopup(val) }}
              className="w-5 h-5 rounded flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50 opacity-0 group-hover:opacity-100 transition cursor-pointer flex-shrink-0"
              title="View full description"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      }
    },
    { accessorKey: 'since', header: 'Since', size: 90, meta: { className: 'font-mono text-xs' } },
  ], [])

  const columns = useMemo(() => [
    ...COLUMNS,
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
              if (window.confirm(`Are you sure you want to remove ${row.original.name}?`)) {
                removeMut.mutate({ sr_no: row.original.sr_no, sheet: activeSheet || row.original.sheet, user: 'System' })
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
  ], [onEdit, activeSheet, removeMut, COLUMNS])

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
      {/* Toolbar */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-500 font-medium">
            Showing <strong className="text-slate-700">{rows.length}</strong> of <strong className="text-slate-700">{total}</strong> candidates
          </p>
          {isFetching && <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
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
          <button onClick={() => qc.invalidateQueries({ queryKey: ['sheet-data'] })}
            className="ml-2 w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-blue-50 text-slate-400 hover:text-blue-500 transition cursor-pointer"
            title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Active Filter Pills */}
      {activeFilterCount > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-1.5 bg-blue-50/30">
          {Object.entries(filters).map(([key, val]) => {
            const display = Array.isArray(val) ? val.join(', ') : val
            if (!display) return null
            return (
              <span key={key} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full text-[11px] font-semibold">
                {FILTERABLE[key] || key}: {display}
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
                    const isFilterable = colKey && FILTERABLE[colKey]
                    const opts = filterOptions?.[colKey] || []
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
                          {isFilterable && opts.length > 0 && (
                            <HeaderFilter
                              column={colKey}
                              label={FILTERABLE[colKey]}
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
    </div>
  )
}
