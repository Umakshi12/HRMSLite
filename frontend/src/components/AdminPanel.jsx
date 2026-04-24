import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { grantAccessSchema } from '../lib/schemas'
import { getUsers, grantAccess, resetPassword, removeUser, getSheetSummary } from '../lib/api'
import { getSheets } from '../lib/mockData'
import useStore from '../lib/store'
import { toast } from 'sonner'
import { UserPlus, Key, Trash2, ShieldCheck } from 'lucide-react'

export default function AdminPanel() {
  const { user } = useStore()
  const qc = useQueryClient()

  // Dynamic sheets
  const { data: summaryData } = useQuery({ queryKey: ['sheet-summary'], queryFn: getSheetSummary })
  const sheets = summaryData?.sheets?.length ? summaryData.sheets.map((s) => s.name) : getSheets()

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    placeholderData: { users: [] },
  })
  const users = usersData?.users || []

  // Grant Access Form
  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(grantAccessSchema),
    defaultValues: { role: 'User', sheet_access: [] },
  })

  const grantMut = useMutation({
    mutationFn: (data) => grantAccess({ ...data, granted_by: user?.login_id }),
    onSuccess: (res) => { 
      toast.success(res.message || 'Access granted', { description: `Login ID: ${res.login_id}\nPassword: ${res.password}`, duration: 10000 }); 
      qc.invalidateQueries(['users']); 
      reset(); 
    },
    onError: (err) => toast.error(err.message),
  })

  const resetMut = useMutation({
    mutationFn: (loginId) => resetPassword(loginId, user?.login_id),
    onSuccess: (res) => toast.success('Password Reset', { description: `Temporary password: ${res.tempPassword}`, duration: 10000 }),
    onError: (err) => toast.error(err.message),
  })

  const removeMut = useMutation({
    mutationFn: (loginId) => removeUser(loginId, user?.login_id),
    onSuccess: () => { toast.success('User removed'); qc.invalidateQueries(['users']) },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Grant Access */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h4 className="text-base font-bold flex items-center gap-2 mb-5">
          <UserPlus className="w-5 h-5 text-blue-600" />
          Grant Access
        </h4>
        <form onSubmit={handleSubmit((d) => grantMut.mutate(d))} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Email or Phone *</label>
            <input {...register('identifier')} placeholder="user@example.com" className="field-input" />
            {errors.identifier && <p className="text-[11px] text-red-500 mt-0.5">{errors.identifier.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Role *</label>
              <select {...register('role')} className="field-input">
                <option value="User">User</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Sheet Access</label>
              <select {...register('sheet_access')} multiple className="field-input h-20">
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
            <input {...register('notes')} placeholder="Optional admin notes" className="field-input" />
          </div>
          <button type="submit" disabled={grantMut.isPending} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-bold transition disabled:opacity-50 cursor-pointer">
            {grantMut.isPending ? 'Granting...' : 'Grant Access'}
            <Key className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* User List */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h4 className="text-base font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            Active Users
          </h4>
          <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-bold">{users.length} Users</span>
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 skeleton rounded-lg" />)}</div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {users.map((u) => (
              <div key={u.login_id} className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition group">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                    {u.identifier?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{u.login_id}</p>
                    <p className="text-xs text-slate-400">{u.identifier}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                    u.role === 'Admin' ? 'bg-blue-50 text-blue-600' : u.role === 'Super Admin' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-500'
                  }`}>{u.role}</span>
                  <button onClick={() => { if (confirm('Reset password?')) resetMut.mutate(u.login_id) }}
                    className="w-7 h-7 rounded hover:bg-amber-50 text-amber-500 items-center justify-center hidden group-hover:flex" title="Reset Password">
                    <Key className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm(`Remove ${u.login_id}?`)) removeMut.mutate(u.login_id) }}
                    className="w-7 h-7 rounded hover:bg-red-50 text-red-500 items-center justify-center hidden group-hover:flex" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
