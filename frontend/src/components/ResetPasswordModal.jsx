import { useState } from 'react'
import { X, Send, Smartphone, Mail, Key } from 'lucide-react'
import { apiFetch } from '../lib/api'

/**
 * Modal to reset a user's password and deliver credentials via email or SMS.
 *
 * Props:
 *   user      – { login_id, name, email, phone }
 *   onClose   – () => void
 */
export default function ResetPasswordModal({ user, onClose }) {
  const [channel, setChannel] = useState('email')
  const [loading, setLoading]  = useState(false)
  const [result,  setResult]   = useState(null) // { success, message }

  if (!user) return null

  const handleSend = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await apiFetch('/send-credentials', {
        method: 'POST',
        body: JSON.stringify({ target_login_id: user.login_id, channel }),
      })
      setResult({ success: res.success, message: res.success ? `Credentials sent via ${channel}!` : res.message })
    } catch (e) {
      setResult({ success: false, message: e.message || 'Request failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Key className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Send Credentials</h2>
              <p className="text-xs text-slate-500">{user.name || user.login_id}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600">
            This will generate a new temporary password and deliver login instructions to the user.
          </p>

          {/* Channel selector */}
          <div className="flex gap-2">
            {[
              { id: 'email', icon: Mail, label: 'Email', value: user.email },
              { id: 'sms',   icon: Smartphone, label: 'SMS', value: user.phone },
            ].map(({ id, icon: Icon, label, value }) => (
              <button key={id} onClick={() => setChannel(id)}
                className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-sm font-medium transition ${channel === id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                <Icon className="w-5 h-5" />
                <span>{label}</span>
                {value && <span className="text-[10px] opacity-60 truncate max-w-full px-2">{value}</span>}
              </button>
            ))}
          </div>

          {/* Result */}
          {result && (
            <div className={`text-sm px-3 py-2 rounded-xl ${result.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {result.message}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button onClick={handleSend} disabled={loading || result?.success}
              className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 transition">
              <Send className="w-4 h-4" />
              {loading ? 'Sending…' : result?.success ? 'Sent!' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
