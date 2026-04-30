import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSheetSummary, bulkImportCSV } from '../lib/api'
import { getSheets } from '../lib/mockData'
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react'
import { toast } from 'sonner'

export default function BulkImportPage() {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState([])
  const [headers, setHeaders] = useState([])
  const [sheet, setSheet] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const { data: summary } = useQuery({ queryKey: ['sheet-summary'], queryFn: getSheetSummary })
  const sheets = summary?.sheets?.length ? summary.sheets.map(s => s.name) : getSheets()

  const handleFile = (f) => {
    if (!f) return
    setFile(f)
    setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const lines = text.split('\n').filter(Boolean)
      if (!lines.length) return
      const hs = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
      setHeaders(hs)
      const rows = lines.slice(1, 6).map(l =>
        l.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      )
      setPreview(rows)
    }
    reader.readAsText(f)
  }

  const handleImport = async () => {
    if (!file || !sheet) { toast.error('Select a sheet first'); return }
    setLoading(true)
    try {
      const res = await bulkImportCSV(sheet, file)
      setResult(res)
      if (res.success) toast.success(`Imported ${res.imported} records`)
      else toast.error(res.message)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const reset = () => { setFile(null); setPreview([]); setHeaders([]); setResult(null); if (fileRef.current) fileRef.current.value = '' }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Bulk CSV Import</h2>
        <p className="text-sm text-slate-400 mt-1">Upload a CSV file to import multiple candidates at once into any sheet.</p>
      </div>

      {/* Step 1: File + Sheet */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="font-semibold text-slate-700">Step 1: Select File & Target Sheet</h3>

        <div
          className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
        >
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileText className="w-8 h-8 text-blue-500" />
              <div className="text-left">
                <p className="font-semibold text-slate-700">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB · {preview.length} preview rows</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); reset() }} className="ml-4 text-slate-400 hover:text-red-500"><X className="w-5 h-5" /></button>
            </div>
          ) : (
            <div>
              <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-500">Drop CSV here or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">First row must be headers (Name, Mobile, Address, State, Area…)</p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Target Sheet *</label>
          <select value={sheet} onChange={e => setSheet(e.target.value)} className="field-input">
            <option value="">— Select sheet —</option>
            {sheets.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-semibold text-slate-700 mb-3">Step 2: Preview (first {preview.length} rows)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>{headers.map(h => <th key={h} className="excel-th px-3 py-2 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="excel-row">
                    {row.map((cell, j) => <td key={j} className="excel-td px-3 py-1.5 truncate max-w-[120px]">{cell || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-2">Columns are auto-mapped to sheet headers by name.</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-xl p-5 border ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-3 mb-3">
            {result.success ? <CheckCircle className="w-5 h-5 text-green-600" /> : <AlertCircle className="w-5 h-5 text-red-500" />}
            <span className="font-semibold">{result.success ? `Imported ${result.imported} records` : result.message}</span>
            {result.skipped > 0 && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{result.skipped} skipped</span>}
          </div>
          {result.errors?.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Import Button */}
      {file && sheet && !result && (
        <button onClick={handleImport} disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? 'Importing...' : `Import to "${sheet}"`}
          <Upload className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
