import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { candidateSchema } from '../lib/schemas'
import { addCandidate, editCandidate, checkMobile, getSheetSummary } from '../lib/api'
import { getSheets } from '../lib/mockData'
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
  const sheets = summary?.sheets?.length ? summary.sheets.map((s) => s.name) : getSheets()

  const today = format(new Date(), 'dd-MM-yyyy')

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(candidateSchema),
    defaultValues: isEdit
      ? { ...editData, sheet: editData.sheet || activeSheet || 'Japa' }
      : { sheet: activeSheet || 'Japa', since: today, verification: 'not verified', salary: 0, gender: 'Female', experience: '<1 year', education: '10th Pass' },
  })

  const dob = watch('dob')
  const calcAge = (dobStr) => {
    if (!dobStr || !/^\d{2}-\d{2}-\d{4}$/.test(dobStr)) return ''
    const [d, m, y] = dobStr.split('-').map(Number)
    const born = new Date(y, m - 1, d)
    const age = Math.floor((Date.now() - born.getTime()) / 31557600000)
    return age >= 0 && age < 120 ? age : ''
  }

  const addMut = useMutation({
    mutationFn: (data) => addCandidate(data.sheet, data, user?.login_id),
    onSuccess: () => {
      toast.success('Candidate added successfully')
      qc.invalidateQueries({ queryKey: ['sheet-data'] })
      qc.invalidateQueries({ queryKey: ['sheet-summary'] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  const editMut = useMutation({
    mutationFn: (data) => editCandidate(editData.sr_no, editData._sheet || editData.sheet || activeSheet, data.sheet, data, user?.login_id),
    onSuccess: () => {
      toast.success('Candidate updated')
      qc.invalidateQueries({ queryKey: ['sheet-data'] })
      qc.invalidateQueries({ queryKey: ['sheet-summary'] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  const onSubmit = (data) => {
    if (isEdit) editMut.mutate(data)
    else addMut.mutate(data)
  }

  const loading = addMut.isPending || editMut.isPending

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[780px] max-h-[90vh] flex flex-col shadow-2xl animate-in" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-bold">{isEdit ? 'Edit Candidate' : 'Add New Candidate'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6">
          {isEdit && (
            <div className="mb-4 px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500">
              Sr. No: <strong className="text-slate-700">{editData.sr_no}</strong>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <Field label="Category *" error={errors.sheet}>
              <select {...register('sheet')} className="field-input">
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="Full Name *" error={errors.name}>
              <input {...register('name')} placeholder="Candidate name" className="field-input" />
            </Field>

            <Field label="Mobile No. *" error={errors.mobile}>
              <div className="relative group/mobile">
                <input {...register('mobile')} placeholder="10-digit number" maxLength={10} className="field-input pr-20" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1.5 opacity-0 group-hover/mobile:opacity-100 transition-opacity">
                  {watch('mobile') && watch('mobile').length >= 10 && (
                    <>
                      <a
                        href={`tel:${watch('mobile')}`}
                        className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all duration-200"
                        title="Call now"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                      <a
                        href={`https://wa.me/${watch('mobile').length === 10 ? '91' + watch('mobile') : watch('mobile')}`}
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
            </Field>

            <Field label="Gender *" error={errors.gender}>
              <select {...register('gender')} className="field-input">
                {GENDER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="DOB (DD-MM-YYYY) *" error={errors.dob}>
              <input {...register('dob')} placeholder="DD-MM-YYYY" className="field-input" />
            </Field>

            <Field label="Age (auto)">
              <input value={calcAge(dob)} readOnly className="field-input bg-slate-50 text-slate-400" />
            </Field>

            <Field label="Address" error={errors.address}>
              <input {...register('address')} placeholder="Street/locality" className="field-input" />
            </Field>

            <Field label="State" error={errors.state}>
              <select {...register('state')} className="field-input">
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="Area" error={errors.area}>
              <input {...register('area')} placeholder="e.g. Bandra, Airoli" className="field-input" />
            </Field>

            <Field label="Marital Status">
              <select {...register('marital_status')} className="field-input">
                <option value="">Select</option>
                {MARITAL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="Timing">
              <select {...register('timing')} className="field-input">
                <option value="">Select</option>
                {TIMING_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="Experience *" error={errors.experience}>
              <select {...register('experience')} className="field-input">
                {EXPERIENCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="Education *" error={errors.education}>
              <select {...register('education')} className="field-input">
                {EDUCATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="Salary (₹)" error={errors.salary}>
              <input {...register('salary', { valueAsNumber: true })} type="number" min={0} className="field-input" />
            </Field>

            <Field label="Verification">
              <select {...register('verification')} className="field-input">
                {VERIFICATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="Since *" error={errors.since}>
              <input {...register('since')} placeholder="DD-MM-YYYY" className="field-input" />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Description" error={errors.description}>
              <textarea {...register('description')} maxLength={500} rows={3} placeholder="Skills, interests..." className="field-input resize-y" />
            </Field>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer">Cancel</button>
            <button type="submit" disabled={loading} className="px-5 py-2.5 rounded-lg text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50 shadow-sm cursor-pointer">
              {loading ? 'Saving...' : isEdit ? 'Update Candidate' : 'Add Candidate'}
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
