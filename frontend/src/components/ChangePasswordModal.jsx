import { useState } from 'react'
import { X, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { changePassword } from '../lib/api'
import useStore from '../lib/store'
import { toast } from 'sonner'

export default function ChangePasswordModal({ onClose }) {
  const { user } = useStore()
  const [form, setForm]       = useState({ old: '', new: '', confirm: '' })
  const [show, setShow]       = useState({ old: false, new: false, confirm: false })
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState('')

  const toggle = (field) => setShow(s => ({ ...s, [field]: !s[field] }))
  const set    = (field, val) => { setForm(f => ({ ...f, [field]: val })); setError('') }

  const strength = (pwd) => {
    let s = 0
    if (pwd.length >= 8)              s++
    if (/[A-Z]/.test(pwd))            s++
    if (/[0-9]/.test(pwd))            s++
    if (/[^a-zA-Z0-9]/.test(pwd))    s++
    return s
  }
  const pw = form.new
  const str = strength(pw)
  const strLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][str]
  const strColor = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-400', 'bg-green-500'][str]

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!form.old)               return setError('Current password is required.')
    if (pw.length < 8)           return setError('New password must be at least 8 characters.')
    if (!/[A-Z]/.test(pw))       return setError('New password must contain at least one uppercase letter.')
    if (!/[0-9]/.test(pw))       return setError('New password must contain at least one digit.')
    if (pw !== form.confirm)     return setError('Passwords do not match.')
    if (pw === form.old)         return setError('New password must be different from current password.')

    setLoading(true)
    try {
      const res = await changePassword(user.login_id, form.old, form.new)
      if (res.success) {
        setDone(true)
        toast.success('Password changed successfully!')
      } else {
        setError(res.message || 'Password change failed.')
      }
    } catch (err) {
      setError(err.message || 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Lock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Change Password</h2>
              <p className="text-xs text-slate-500">{user?.login_id}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          {done ? (
            <div className="text-center space-y-4 py-2">
              <div className="mx-auto w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-green-500" />
              </div>
              <div>
                <p className="font-semibold text-slate-800">Password updated!</p>
                <p className="text-xs text-slate-500 mt-1">Your new password is active immediately.</p>
              </div>
              <button onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition">
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Current password */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Current Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={show.old ? 'text' : 'password'}
                    value={form.old}
                    onChange={e => set('old', e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-10 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
                  />
                  <button type="button" onClick={() => toggle('old')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {show.old ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={show.new ? 'text' : 'password'}
                    value={form.new}
                    onChange={e => set('new', e.target.value)}
                    placeholder="Min 8 chars, 1 uppercase, 1 digit"
                    className="w-full pl-9 pr-10 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
                  />
                  <button type="button" onClick={() => toggle('new')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {show.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* Strength meter */}
                {pw.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex gap-1">
                      {[1,2,3,4].map(i => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= str ? strColor : 'bg-slate-100'}`} />
                      ))}
                    </div>
                    <p className={`text-[10px] font-semibold ${['','text-red-500','text-amber-500','text-blue-500','text-green-600'][str]}`}>{strLabel}</p>
                  </div>
                )}
              </div>

              {/* Confirm */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={show.confirm ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={e => set('confirm', e.target.value)}
                    placeholder="••••••••"
                    className={`w-full pl-9 pr-10 py-2.5 border-[1.5px] rounded-lg text-sm focus:ring-2 outline-none transition ${
                      form.confirm && form.confirm !== form.new
                        ? 'border-red-300 focus:ring-red-100'
                        : form.confirm && form.confirm === form.new
                        ? 'border-green-400 focus:ring-green-100'
                        : 'border-slate-200 focus:border-blue-500 focus:ring-blue-100'
                    }`}
                  />
                  <button type="button" onClick={() => toggle('confirm')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {show.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.confirm && form.confirm !== form.new && (
                  <p className="text-[10px] text-red-500 mt-0.5">Passwords do not match</p>
                )}
              </div>

              {/* Requirements */}
              <ul className="text-[10px] text-slate-400 space-y-0.5 pl-1">
                {[
                  [pw.length >= 8,        'At least 8 characters'],
                  [/[A-Z]/.test(pw),      'One uppercase letter'],
                  [/[0-9]/.test(pw),      'One number'],
                  [pw !== form.old || !pw,'Different from current password'],
                ].map(([ok, label]) => (
                  <li key={label} className={`flex items-center gap-1.5 ${ok ? 'text-green-600' : ''}`}>
                    <span className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 text-[8px] font-bold ${ok ? 'border-green-500 bg-green-50 text-green-600' : 'border-slate-300'}`}>
                      {ok ? '✓' : ''}
                    </span>
                    {label}
                  </li>
                ))}
              </ul>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition">
                  {loading ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
