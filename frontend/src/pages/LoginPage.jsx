import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema } from '../lib/schemas'
import { login } from '../lib/api'
import useStore from '../lib/store'
import { toast } from 'sonner'
import { Lock, Mail, ArrowRight, Users } from 'lucide-react'

export default function LoginPage() {
  const { setAuth } = useStore()
  const [loading, setLoading] = useState(false)
  const [attempts, setAttempts] = useState(0)

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
        sessionStorage.setItem('staffurs_token', res.token)
        sessionStorage.setItem('staffurs_user', JSON.stringify(res.user))
        setAuth(res.user, res.token)
        toast.success(`Welcome back, ${res.user.name || 'User'}!`)
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
      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-xl p-10">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
            <Users className="w-7 h-7 text-white" />
          </div>
        </div>

        <h1 className="text-center text-2xl font-extrabold text-slate-800 mb-1">Welcome Back</h1>
        <p className="text-center text-sm text-slate-500 mb-8">
          Sign in to Staffurs HRMSLite
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Identifier */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email or Phone</label>
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
              <a
                href="mailto:hr@staffurs.com?subject=HRMS%20Access%20Support"
                onClick={() => toast.info('Opening your email app to contact HR admin.')}
                className="text-xs text-blue-600 font-semibold cursor-pointer hover:underline"
              >
                Contact Admin
              </a>
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
          Need access? Contact your administrator.
        </p>
      </div>
    </div>
  )
}
