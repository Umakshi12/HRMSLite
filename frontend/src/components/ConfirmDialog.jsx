import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'

/**
 * Generic confirmation dialog.
 *
 * Props:
 *   open        – boolean
 *   title       – string
 *   message     – string | ReactNode
 *   confirmText – string (default: "Confirm")
 *   danger      – boolean (red confirm button)
 *   onConfirm   – () => void | Promise<void>
 *   onClose     – () => void
 */
export default function ConfirmDialog({ open, title, message, confirmText = 'Confirm', danger = false, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const handleConfirm = async () => {
    setLoading(true)
    try { await onConfirm() } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <div className="flex items-center gap-3">
            {danger && (
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
            )}
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5">
          <p className="text-sm text-slate-600 mt-1">{message}</p>

          <div className="flex gap-2 mt-5 justify-end">
            <button onClick={onClose} disabled={loading}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={loading}
              className={`px-4 py-2 rounded-xl text-sm text-white font-semibold disabled:opacity-50 transition ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {loading ? 'Please wait…' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
