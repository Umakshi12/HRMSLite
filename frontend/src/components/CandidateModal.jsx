import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { addCandidate, editCandidate, getSheetSummary, getSpreadsheets, getFilterOptions, sanitizeObject } from '../lib/api'
import { INDIAN_STATES, EXPERIENCE_OPTIONS, EDUCATION_OPTIONS, TIMING_OPTIONS, MARITAL_OPTIONS, GENDER_OPTIONS, VERIFICATION_OPTIONS } from '../lib/config'
import useStore from '../lib/store'
import { toast } from 'sonner'
import { X, Phone, MessageCircle } from 'lucide-react'
import { format } from 'date-fns'

export default function CandidateModal({ editData, onClose }) {
  const { user, activeSheet } = useStore()
  const qc = useQueryClient()
  const isEdit = !!editData

  // Get dynamic sheet list
  const { data: summary } = useQuery({ queryKey: ['sheet-summary'], queryFn: getSheetSummary })
  const sheets = summary?.sheets?.length ? summary.sheets.map((s) => s.name) : []

  const targetSheetName = editData?._sheet || editData?.sheet || activeSheet
  const { data: dynamicOptions } = useQuery({
    queryKey: ['filter-options', targetSheetName],
    queryFn: () => getFilterOptions(targetSheetName),
    enabled: !!targetSheetName,
  })

  const getColOptions = (colName) => {
    if (!dynamicOptions) return null
    const lowerName = String(colName).toLowerCase()
    const key = Object.keys(dynamicOptions).find(k => k.toLowerCase() === lowerName)
    return key ? dynamicOptions[key] : null
  }

  const { data: spreadsheets } = useQuery({ queryKey: ['spreadsheets'], queryFn: getSpreadsheets, placeholderData: [] })

  const dynamicSheet = useMemo(() => {
    if (!spreadsheets) return null
    return spreadsheets.find(s => s.name === (editData?._sheet || editData?.sheet || activeSheet) && s.is_active)
  }, [spreadsheets, activeSheet, editData])

  const columns = useMemo(() => {
    let baseHeaders = []
    if (dynamicSheet && dynamicSheet.columns && dynamicSheet.columns.length > 0) {
      baseHeaders = dynamicSheet.columns.map(c => c.name || c)
    } else if (isEdit && editData) {
      baseHeaders = Object.keys(editData).filter(k => !['_sheet', 'id', 'spreadsheet_id', 'row_index', 'search_vector'].includes(k))
    } else {
      // Fallback
      baseHeaders = ['Sr.', 'Name', 'Mobile No', 'Address', 'State', 'Area', 'Experience', 'Education', 'DOB', 'Age', 'Gender', 'Salary', 'Verification', 'Description', 'Since', 'Added By', 'Last Updated']
    }
    // Remove auto-generated fields so user doesn't fill them
    return baseHeaders.filter(h => !['Sr.', 'Sr', 'Sr No', 'Sr. No', 'Added By', 'Last Updated', 'Modified By', 'Created By', 'Created At', 'Modified At', 'Updated By', 'Updated At', 'Age'].includes(h))
  }, [dynamicSheet, isEdit, editData])

  const today = format(new Date(), 'dd-MM-yyyy')

  // Prepare default values
  const defaultValues = useMemo(() => {
    if (isEdit) {
      const vals = { ...editData, sheet: editData._sheet || editData.sheet || activeSheet || 'Japa' }
      return vals
    }
    // Default values for new candidate based on known columns
    const vals = { sheet: activeSheet || 'Japa' }
    columns.forEach(col => {
      const lower = String(col).toLowerCase()
      if (lower.includes('since') || lower === 'date') vals[col] = today
      else if (lower.includes('verification') || lower === 'status') vals[col] = 'not verified'
      else if (lower.includes('salary')) vals[col] = 0
      else if (lower.includes('gender')) vals[col] = 'Female'
      else if (lower.includes('experience')) vals[col] = '<1 year'
      else if (lower.includes('education')) vals[col] = '10th Pass'
      else vals[col] = ''
    })
    return vals
  }, [isEdit, editData, activeSheet, columns, today])

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm({
    defaultValues
  })

  // Age calculation helper based on finding a dob column
  const dobField = columns.find(c => String(c).toLowerCase().includes('dob') || String(c).toLowerCase().includes('date of birth'))
  const dobVal = dobField ? watch(dobField) : ''
  const calcAge = (dobStr) => {
    if (!dobStr || !/^\d{2}-\d{2}-\d{4}$/.test(dobStr)) return ''
    const [d, m, y] = dobStr.split('-').map(Number)
    const born = new Date(y, m - 1, d)
    const age = Math.floor((Date.now() - born.getTime()) / 31557600000)
    return age >= 0 && age < 120 ? age : ''
  }

  // Update sheet if it changes in edit mode, or keep it synced with activeSheet for new mode
  useEffect(() => {
    if (!isEdit && activeSheet) {
      setValue('sheet', activeSheet)
    }
  }, [activeSheet, isEdit, setValue])

  const addMut = useMutation({
    mutationFn: (data) => {
      const { sheet, ...candidateData } = data
      return addCandidate(sheet, candidateData, user?.login_id)
    },
    onSuccess: () => {
      toast.success('Record added successfully')
      qc.invalidateQueries({ queryKey: ['sheet-data'] })
      qc.invalidateQueries({ queryKey: ['sheet-summary'] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  const editMut = useMutation({
    mutationFn: (data) => {
      const { sheet, ...candidateData } = data
      // Pass _tab_name so the backend knows which Google Sheets tab to write to
      if (editData._tab_name) candidateData._tab_name = editData._tab_name
      return editCandidate(editData.sr_no || editData.sr || editData['Sr No'], editData.row_index, editData._sheet || editData.sheet || activeSheet, sheet, candidateData, user?.login_id)
    },
    onSuccess: () => {
      toast.success('Record updated successfully')
      qc.invalidateQueries({ queryKey: ['sheet-data'] })
      qc.invalidateQueries({ queryKey: ['sheet-summary'] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  const onSubmit = (data) => {
    // SECURITY: Sanitize all fields for formula injection before sending to backend
    const sanitized = sanitizeObject(data)
    if (isEdit) editMut.mutate(sanitized)
    else addMut.mutate(sanitized)
  }

  const loading = addMut.isPending || editMut.isPending

  // Render dynamic field based on heuristics
  const renderField = (col) => {
    const lower = String(col).toLowerCase()
    
    // Mobile / Phone
    if (lower.includes('mobile') || lower.includes('phone') || lower.includes('contact')) {
      const val = watch(col)
      return (
        <div className="relative group/mobile">
          <input 
            {...register(col, { required: 'Mobile is required', minLength: { value: 10, message: 'Min 10 digits' } })} 
            placeholder="10-digit number" 
            maxLength={13} 
            className="field-input pr-20" 
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1.5 opacity-0 group-hover/mobile:opacity-100 transition-opacity">
            {val && val.length >= 10 && (
              <>
                <a
                  href={`tel:${val}`}
                  className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all duration-200"
                  title="Call now"
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
                <a
                  href={`https://wa.me/${val.length === 10 ? '91' + val : val}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-7 h-7 rounded-lg bg-green-50 text-green-600 flex items-center justify-center hover:bg-green-600 hover:text-white transition-all duration-200"
                  title="Open WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </a>
              </>
            )}
          </div>
        </div>
      )
    }

    // Name
    if (lower === 'name' || lower === 'full name' || lower === 'candidate' || lower === 'candidate name') {
      return <input {...register(col, { required: 'Name is required' })} placeholder={`Enter ${col}`} className="field-input" />
    }

    // Dropdowns
    if (lower.includes('gender')) {
      const opts = getColOptions(col) || GENDER_OPTIONS
      return (
        <select {...register(col)} className="field-input">
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (lower.includes('state')) {
      const opts = getColOptions(col) || INDIAN_STATES
      return (
        <select {...register(col)} className="field-input">
          <option value="">Select state</option>
          {opts.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )
    }
    if (lower.includes('marital')) {
      const opts = getColOptions(col) || MARITAL_OPTIONS
      return (
        <select {...register(col)} className="field-input">
          <option value="">Select</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (lower.includes('timing') || lower.includes('shift')) {
      const opts = getColOptions(col) || TIMING_OPTIONS
      return (
        <select {...register(col)} className="field-input">
          <option value="">Select</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (lower.includes('experience') || lower === 'exp') {
      const opts = getColOptions(col) || EXPERIENCE_OPTIONS
      return (
        <select {...register(col)} className="field-input">
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (lower.includes('education') || lower === 'degree') {
      const opts = getColOptions(col) || EDUCATION_OPTIONS
      return (
        <select {...register(col)} className="field-input">
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (lower.includes('verification') || lower === 'status') {
      const opts = getColOptions(col) || VERIFICATION_OPTIONS
      return (
        <select {...register(col)} className="field-input">
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    
    // Numbers
    if (lower.includes('salary')) {
      return <input {...register(col, { valueAsNumber: true })} type="number" min={0} className="field-input" />
    }

    // Textareas
    if (lower.includes('description') || lower.includes('remark') || lower.includes('note')) {
      return <textarea {...register(col)} maxLength={500} rows={3} placeholder="Details..." className="field-input resize-y" />
    }

    // Fallback Input with dynamic datalist dropdown if options exist
    const opts = getColOptions(col)
    const hasOpts = opts && opts.length > 0
    const isDateField = lower.includes('dob') || lower.includes('since') || lower === 'date'
    
    return (
      <div className="relative w-full">
        <input 
          {...register(col)} 
          list={hasOpts ? `datalist-${col}` : undefined}
          placeholder={isDateField ? "DD-MM-YYYY" : `Enter ${col}`} 
          className="field-input w-full" 
        />
        {hasOpts && (
          <datalist id={`datalist-${col}`}>
            {opts.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        )}
      </div>
    )
  }

  // Separate description-like fields to put them at the bottom
  const normalCols = columns.filter(c => {
    const l = String(c).toLowerCase()
    return !l.includes('description') && !l.includes('remark') && !l.includes('note')
  })
  const textCols = columns.filter(c => {
    const l = String(c).toLowerCase()
    return l.includes('description') || l.includes('remark') || l.includes('note')
  })

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[780px] max-h-[90vh] flex flex-col shadow-2xl animate-in" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold">{isEdit ? 'Edit Record' : 'Add New Record'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6">
          {isEdit && (editData.sr_no || editData.sr || editData['Sr No']) && (
            <div className="mb-4 px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500">
              Sr. No: <strong className="text-slate-700">{editData.sr_no || editData.sr || editData['Sr No']}</strong>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Category *" error={errors.sheet}>
              <select {...register('sheet')} className="field-input">
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            {normalCols.map(col => (
              <Field key={col} label={`${col}${['name', 'mobile', 'full name', 'candidate name', 'candidate'].includes(String(col).toLowerCase()) || String(col).toLowerCase().includes('mobile') || String(col).toLowerCase().includes('phone') ? ' *' : ''}`} error={errors[col]}>
                {renderField(col)}
              </Field>
            ))}

            {dobField && (
              <Field label="Age (auto)">
                <input value={calcAge(dobVal)} readOnly className="field-input bg-slate-50 text-slate-400" />
              </Field>
            )}
          </div>

          {textCols.length > 0 && (
            <div className="mt-4 space-y-4">
              {textCols.map(col => (
                <Field key={col} label={col} error={errors[col]}>
                  {renderField(col)}
                </Field>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={loading} className="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50 shadow-sm cursor-pointer">
              {loading ? 'Saving...' : isEdit ? 'Update Data' : 'Add Data'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, error, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-500 mb-1">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-0.5">{error.message}</p>}
    </div>
  )
}
