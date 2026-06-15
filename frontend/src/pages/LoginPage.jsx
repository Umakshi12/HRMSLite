import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema } from '../lib/schemas'
import { login, forgotPassword } from '../lib/api'
import useStore from '../lib/store'
import { toast } from 'sonner'
import { Lock, Mail, ArrowRight, Users, X, Send } from 'lucide-react'

function ForgotPasswordModal({ onClose }) {
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!identifier.trim()) return
    setLoading(true)
    try {
      await forgotPassword(identifier.trim())
      setDone(true)
    } catch {
      // Always show success to prevent enumeration
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <Lock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Forgot Password</h2>
              <p className="text-xs text-slate-500">We'll send a new password to your email</p>
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
                <Send className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">Check your inbox</p>
                <p className="text-xs text-slate-500 mt-1">
                  If that account exists, a new password has been sent to the registered email address.
                </p>
              </div>
              <button onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition">
                Back to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-slate-600">
                Enter your email address or Login ID. We'll generate a new temporary password and send it to your registered email.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email or Login ID</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    placeholder="agent@staffurs.com or login_id"
                    className="w-full pl-10 pr-4 py-3 border-[1.5px] border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition">
                  Cancel
                </button>
                <button type="submit" disabled={loading || !identifier.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 transition">
                  <Send className="w-4 h-4" />
                  {loading ? 'Sending…' : 'Send Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { setAuth } = useStore()
  const [loading, setLoading] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [showForgot, setShowForgot] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data) => {
    if (attempts >= 5) {
      toast.error('Account temporarily locked. Try again in 30 minutes.')
      return
    }
    setLoading(true)
    try {
      const res = await login(data.identifier, data.password)
      if (res.success) {
        setAuth(res.user)
        sessionStorage.setItem('sheetsync_user', JSON.stringify(res.user))
        toast.success(`Welcome back, ${res.user.name || res.user.identifier}!`)
      } else {
        setAttempts((a) => a + 1)
        toast.error(res.message || 'Invalid credentials')
      }
    } catch (err) {
      console.error('Login Error:', err)
      toast.error('Cannot connect to the backend server. Please ensure it is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-slate-50 to-teal-50 p-4">
      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}

      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-xl p-10">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
            <Users className="w-7 h-7 text-white" />
          </div>
        </div>

        <h1 className="text-center text-2xl font-extrabold text-slate-800 mb-1">Welcome Back</h1>
        <p className="text-center text-sm text-slate-500 mb-8">
          Sign in to SheetSync Pro
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Identifier */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email or Login ID</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('identifier')}
                type="text"
                placeholder="agent@staffurs.com"
                className="w-full pl-10 pr-4 py-3 border-[1.5px] border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
              />
            </div>
            {errors.identifier && <p className="text-xs text-red-500 mt-1">{errors.identifier.message}</p>}
          </div>

          {/* Password */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-500">Password</label>
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-xs text-blue-600 font-semibold hover:underline cursor-pointer"
              >
                Forgot Password?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                {...register('password')}
                type="password"
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 border-[1.5px] border-slate-200 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition"
              />
            </div>
            {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
          </div>

          {attempts > 0 && attempts < 5 && (
            <p className="text-xs text-amber-600 text-center">
              {5 - attempts} attempt(s) remaining before lockout
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm font-bold transition shadow-md shadow-blue-200 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          Need access? <a href="mailto:staffurs2026@gmail.com" className="text-blue-500 hover:underline">Contact Admin</a>
        </p>
      </div>
    </div>
  )
}
