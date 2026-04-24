import { useState, useMemo } from 'react'
import useStore from '../lib/store'
import { SlidersHorizontal, X } from 'lucide-react'
import { getFilterOptions } from '../lib/api'
import { useQuery } from '@tanstack/react-query'
import * as CONFIG_DEFAULTS from '../lib/config'

export default function FilterBar() {
  const [open, setOpen] = useState(false)
  const { activeSheet, filters, setFilters, clearFilters } = useStore()

  const { data: dynamicOptions } = useQuery({
    queryKey: ['filter-options', activeSheet],
    queryFn: () => getFilterOptions(activeSheet),
  })

  const options = useMemo(() => ({
    gender: dynamicOptions?.gender || CONFIG_DEFAULTS.GENDER_OPTIONS,
    experience: dynamicOptions?.experience || CONFIG_DEFAULTS.EXPERIENCE_OPTIONS,
    education: dynamicOptions?.education || CONFIG_DEFAULTS.EDUCATION_OPTIONS,
    timing: dynamicOptions?.timing || CONFIG_DEFAULTS.TIMING_OPTIONS,
    marital_status: dynamicOptions?.marital_status || CONFIG_DEFAULTS.MARITAL_OPTIONS,
    verification: dynamicOptions?.verification || CONFIG_DEFAULTS.VERIFICATION_OPTIONS,
    state: dynamicOptions?.state || CONFIG_DEFAULTS.INDIAN_STATES,
  }), [dynamicOptions])

  const activeCount = Object.values(filters).filter((v) => (Array.isArray(v) ? v.length : v)).length

  const updateFilter = (key, value) => {
    setFilters({ ...filters, [key]: value })
  }

  const removeFilter = (key) => {
    const next = { ...filters }
    delete next[key]
    setFilters(next)
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      {/* Toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 transition"
      >
        <SlidersHorizontal className="w-4 h-4" />
        Filters
        {activeCount > 0 && (
          <span className="bg-blue-600 text-white text-[11px] px-2 py-0.5 rounded-full font-bold">{activeCount}</span>
        )}
        {activeCount > 0 && (
          <button onClick={(e) => { e.stopPropagation(); clearFilters() }} className="ml-auto text-xs text-red-500 hover:underline">
            Clear All
          </button>
        )}
      </button>

      {/* Filter Content */}
      {open && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <div className="grid grid-cols-4 gap-3 mt-3">
            <FilterSelect label="Gender" options={options.gender} value={filters.gender || []} onChange={(v) => updateFilter('gender', v)} />
            <FilterSelect label="Experience" options={options.experience} value={filters.experience || []} onChange={(v) => updateFilter('experience', v)} />
            <FilterSelect label="Education" options={options.education} value={filters.education || []} onChange={(v) => updateFilter('education', v)} />
            <FilterSelect label="Timing" options={options.timing} value={filters.timing || []} onChange={(v) => updateFilter('timing', v)} />
            <FilterSelect label="Marital Status" options={options.marital_status} value={filters.marital_status || []} onChange={(v) => updateFilter('marital_status', v)} />
            <FilterSelect label="Verification" options={options.verification} value={filters.verification || []} onChange={(v) => updateFilter('verification', v)} />
            <FilterSelect label="State" options={options.state} value={filters.state || []} onChange={(v) => updateFilter('state', v)} />

            {/* Salary Range */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Salary (₹)</label>
              <div className="flex gap-1">
                <input type="number" placeholder="Min" value={filters.salary_min || ''} onChange={(e) => updateFilter('salary_min', e.target.value)}
                  className="w-1/2 px-2 py-1.5 border border-slate-200 rounded text-xs outline-none focus:border-blue-400" />
                <input type="number" placeholder="Max" value={filters.salary_max || ''} onChange={(e) => updateFilter('salary_max', e.target.value)}
                  className="w-1/2 px-2 py-1.5 border border-slate-200 rounded text-xs outline-none focus:border-blue-400" />
              </div>
            </div>
          </div>

          {/* Active Pills */}
          {activeCount > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {Object.entries(filters).map(([key, val]) => {
                const display = Array.isArray(val) ? val.join(', ') : val
                if (!display) return null
                return (
                  <span key={key} className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-semibold">
                    {key}: {display}
                    <button onClick={() => removeFilter(key)}><X className="w-3 h-3" /></button>
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FilterSelect({ label, options, value, onChange }) {
  const toggle = (opt) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt))
    else onChange([...value, opt])
  }

  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-400 mb-1">{label}</label>
      <select
        multiple
        value={value}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
        className="w-full border border-slate-200 rounded text-xs p-1.5 outline-none focus:border-blue-400 h-20"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
