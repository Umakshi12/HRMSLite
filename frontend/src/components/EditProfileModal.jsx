import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, sanitizeObject } from '../lib/api'
import { toast } from 'sonner'
import { X, Save, Shield, Database, Check, Globe } from 'lucide-react'

export default function EditProfileModal({ user, onClose, sheets = [] }) {
  const qc = useQueryClient()
  const [localAccess, setLocalAccess] = useState([])

  const { register, handleSubmit, reset, watch } = useForm({
    defaultValues: { name: '', identifier: '', phone: '', max_user_quota: 10 }
  })

  useEffect(() => {
    if (user) {
      reset({
        name: user.name || '',
        identifier: user.identifier || '',
        phone: user.phone || '',
        max_user_quota: user.max_user_quota || 10,
      })
      setLocalAccess(user.sheet_access || [])
    }
  }, [user, reset])

  const mut = useMutation({
    mutationFn: (data) => apiFetch('/update-profile', {
      method: 'POST',
      body: JSON.stringify({
        target_login_id: user.login_id,
        ...data,
        sheet_access: localAccess,
      })
    }),
    onSuccess: () => {
      toast.success('Profile updated')
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
      onClose()
    },
    onError: (err) => toast.error(err.message)
  })

  if (!user) return null

  const targetRole = String(user.role).toLowerCase().replace(/\s+/g, '_')
  const isTargetAdmin = targetRole === 'admin'
  const isTargetSuperAdmin = targetRole === 'super_admin'
  const hasFullAccess = isTargetAdmin || isTargetSuperAdmin

  const toggleSheet = (sheet) => {
    setLocalAccess(prev =>
      prev.includes(sheet) ? prev.filter(s => s !== sheet) : [...prev, sheet]
    )
  }

  const grantAll = () => setLocalAccess([...sheets])
  const revokeAll = () => setLocalAccess([])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />Edit Profile
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Updating: <strong className="text-slate-600">{user.login_id}</strong></p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-xl text-slate-400 transition border border-transparent hover:border-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit((d) => mut.mutate(sanitizeObject(d)))} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Name + Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
              <input {...register('name')} className="field-input text-sm" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Phone</label>
              <input {...register('phone')} className="field-input text-sm" placeholder="+919876543210" />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email / Login ID</label>
            <input {...register('identifier')} className="field-input text-sm" placeholder="email@example.com" />
          </div>

          {/* Max quota (admins only) */}
          {isTargetAdmin && (
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Max User Quota</label>
              <input {...register('max_user_quota')} type="number" min="1" max="1000" className="field-input text-sm" />
              <p className="text-[10px] text-slate-400 mt-1">Max number of users this admin can create.</p>
            </div>
          )}

          {/* Sheet Access */}
          {isTargetSuperAdmin ? (
            <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-100 rounded-xl">
              <Globe className="w-4 h-4 text-purple-500" />
              <div>
                <p className="text-xs font-bold text-purple-700">Super Admin — Full Access</p>
                <p className="text-[10px] text-purple-500">Has unrestricted access to all sheets.</p>
              </div>
            </div>
          ) : isTargetAdmin ? (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <Globe className="w-4 h-4 text-blue-500" />
              <div>
                <p className="text-xs font-bold text-blue-700">Admin — Full Access</p>
                <p className="text-[10px] text-blue-500">Admins can access all sheets by default.</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Sheet Access
                  <span className="ml-2 normal-case text-blue-600 font-bold">
                    {localAccess.length}/{sheets.length}
                  </span>
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={grantAll}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-700 px-2 py-0.5 rounded-lg hover:bg-blue-50 transition cursor-pointer">
                    All
                  </button>
                  <button type="button" onClick={revokeAll}
                    className="text-[10px] font-bold text-slate-500 hover:text-red-500 px-2 py-0.5 rounded-lg hover:bg-red-50 transition cursor-pointer">
                    None
                  </button>
                </div>
              </div>

              {sheets.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic p-3 border border-dashed border-slate-200 rounded-lg">
                  No spreadsheets connected yet.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {sheets.map(sheet => {
                    const active = localAccess.includes(sheet)
                    return (
                      <button key={sheet} type="button" onClick={() => toggleSheet(sheet)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          active
                            ? 'bg-blue-50 border-blue-200 hover:bg-blue-100'
                            : 'bg-white border-slate-150 hover:bg-slate-50 hover:border-slate-200'
                        }`}>
                        {/* Custom checkbox */}
                        <div className={`w-4.5 h-4.5 w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 transition-all ${
                          active ? 'bg-blue-600' : 'border-2 border-slate-300 bg-white'
                        }`}>
                          {active && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        </div>
                        <Database className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-blue-500' : 'text-slate-400'}`} />
                        <span className={`text-xs font-medium flex-1 ${active ? 'text-blue-700' : 'text-slate-600'}`}>
                          {sheet}
                        </span>
                        {/* Toggle pill */}
                        <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${active ? 'bg-blue-500' : 'bg-slate-200'}`}>
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${active ? 'left-4' : 'left-0.5'}`} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 transition cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={mut.isPending}
              className="flex-1 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition shadow-lg shadow-blue-100 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
              {mut.isPending ? 'Saving...' : <><Save className="w-4 h-4" />Save Changes</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
