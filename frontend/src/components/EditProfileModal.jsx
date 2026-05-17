import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, sanitizeObject } from '../lib/api'
import { toast } from 'sonner'
import { X, Save, Shield } from 'lucide-react'

export default function EditProfileModal({ user, onClose, sheets = [] }) {
  const qc = useQueryClient()
  const { register, handleSubmit, reset, watch, setValue } = useForm({
    defaultValues: {
      name: '',
      identifier: '',
      phone: '',
      sheet_access: [],
      max_user_quota: 10
    }
  })

  useEffect(() => {
    if (user) {
      reset({
        name: user.name || '',
        identifier: user.identifier || '',
        phone: user.phone || '',
        sheet_access: user.sheet_access || [],
        max_user_quota: user.max_user_quota || 10
      })
    }
  }, [user, reset])

  const mut = useMutation({
    mutationFn: (data) => apiFetch('/update-profile', {
      method: 'POST',
      body: JSON.stringify({
        target_login_id: user.login_id,
        ...data
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

  const isTargetAdmin = String(user.role).toLowerCase().replace(/\s+/g, '_') === 'admin'
  const isTargetSuperAdmin = String(user.role).toLowerCase().replace(/\s+/g, '_') === 'super_admin'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Edit Profile
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Updating user {user.login_id}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-xl text-slate-400 transition shadow-sm border border-transparent hover:border-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
 
        <form onSubmit={handleSubmit((d) => mut.mutate(sanitizeObject(d)))} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
              <input {...register('name')} className="field-input text-sm" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Phone Number</label>
              <input {...register('phone')} className="field-input text-sm" placeholder="+919876543210" />
            </div>
          </div>
 
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email / Login ID</label>
            <input {...register('identifier')} className="field-input text-sm" placeholder="email@example.com" />
          </div>
 
          {isTargetAdmin && (
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Max User Quota</label>
              <input {...register('max_user_quota')} type="number" min="1" max="1000" className="field-input text-sm" />
              <p className="text-[10px] text-slate-400 mt-1">Number of users this admin can manage.</p>
            </div>
          )}
 
          {!isTargetSuperAdmin && (
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Tab Access</label>
              <select {...register('sheet_access')} multiple className="field-input text-sm h-32">
                {sheets.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">Hold Ctrl/Cmd to select multiple tabs.</p>
            </div>
          )}

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={mut.isPending} className="flex-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition shadow-lg shadow-blue-200 flex items-center justify-center gap-2 disabled:opacity-50">
              {mut.isPending ? 'Saving...' : <><Save className="w-4 h-4" /> Save Changes</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
