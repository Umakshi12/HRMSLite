import { useCallback, useRef, useState, useEffect } from 'react'
import useStore from '../lib/store'
import { Search, X, Loader2 } from 'lucide-react'

export default function SearchBar() {
  const { searchQuery, setSearchQuery, searchAllSheets, setSearchAllSheets } = useStore()
  const [localQuery, setLocalQuery] = useState(searchQuery)
  const debounceRef = useRef(null)

  // Sync store → local on external changes
  useEffect(() => {
    setLocalQuery(searchQuery)
  }, [searchQuery])

  const handleChange = useCallback((e) => {
    const value = e.target.value
    setLocalQuery(value)

    // Debounce: wait 600ms after user stops typing
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value)
    }, 600)
  }, [setSearchQuery])

  const clearSearch = useCallback(() => {
    setLocalQuery('')
    setSearchQuery('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [setSearchQuery])

  const isSearching = localQuery !== searchQuery && localQuery.length >= 2

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
        <input
          type="text"
          value={localQuery}
          onChange={handleChange}
          placeholder="Search candidates... e.g., 'Female cook in Mumbai with 5 years exp'"
          className="w-full pl-11 pr-12 py-3.5 bg-white border-[1.5px] border-slate-200 rounded-xl text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition font-medium placeholder:text-slate-400"
        />
        {localQuery && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {isSearching && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
            <button
              onClick={clearSearch}
              className="w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center transition cursor-pointer"
            >
              <X className="w-3 h-3 text-slate-500" />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-2">
        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={searchAllSheets}
            onChange={(e) => setSearchAllSheets(e.target.checked)}
            className="accent-blue-600 w-3.5 h-3.5"
          />
          Search All Sheets
        </label>
        {searchQuery.length >= 2 && (
          <span className="text-xs text-blue-500 ml-auto font-medium">
            Smart search active — fuzzy + intent matching
          </span>
        )}
      </div>
    </div>
  )
}
