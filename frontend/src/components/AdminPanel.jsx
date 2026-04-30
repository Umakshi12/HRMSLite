import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { grantAccessSchema } from '../lib/schemas'
import { getUsers, grantAccess, resetPassword, removeUser, getSheetSummary, updateUserRights, updateUserLimit, getAdminDashboard } from '../lib/api'
import { getSheets } from '../lib/mockData'
import useStore from '../lib/store'
import { toast } from 'sonner'
import { UserPlus, Key, Trash2, ShieldCheck, Edit2, Check, X, ShieldAlert } from 'lucide-react'

export default function AdminPanel() {
  const { user } = useStore()
  const qc = useQueryClient()
  
  // Normalize role
  const rawRole = String(user?.role).toLowerCase().replace(/\s+/g, '_')
  const isSuperAdmin = rawRole === 'super_admin'
  const isAdmin = rawRole === 'admin' || isSuperAdmin

  const [editingAccess, setEditingAccess] = useState(null)
  const [editingLimit, setEditingLimit] = useState(null)
  const [limitValue, setLimitValue] = useState('')

  const { data: summaryData } = useQuery({ queryKey: ['sheet-summary'], queryFn: getSheetSummary })
  const sheets = summaryData?.sheets?.length ? summaryData.sheets.map((s) => s.name) : getSheets()

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    placeholderData: { users: [] },
  })
  const users = usersData?.users || []

  // Super Admin global dashboard data
  const { data: dashboardData } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: getAdminDashboard,
    enabled: isSuperAdmin
  })

  // Admin logic (for Admin, they only get their own users back from backend)
  // But we still want to compute slots for the current admin
  const myGrantedUsers = users.filter(u => u.created_by === user?.login_id)
  
  // To get the max limit for the current user, we use user context max_user_quota or fetch it
  const myMaxUsers = parseInt(user?.max_user_quota) || 10

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    resolver: zodResolver(grantAccessSchema),
    defaultValues: { role: 'user', sheet_access: [] },
  })
  const selectedRole = watch('role')

  const grantMut = useMutation({
    mutationFn: (data) => grantAccess({ ...data, created_by: user?.login_id }),
    onSuccess: (res) => {
      toast.success(res.message || 'Access granted', { description: `Login ID: ${res.login_id}\nPassword: ${res.password}`, duration: 10000 })
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
      reset()
    },
    onError: (err) => toast.error(err.message),
  })

  const resetMut = useMutation({
    mutationFn: (loginId) => resetPassword(loginId, user?.login_id),
    onSuccess: (res) => toast.success('Password Reset', { description: `Temporary: ${res.tempPassword}`, duration: 10000 }),
    onError: (err) => toast.error(err.message),
  })

  const removeMut = useMutation({
    mutationFn: (loginId) => removeUser(loginId, user?.login_id),
    onSuccess: () => { 
      toast.success('User removed'); 
      qc.invalidateQueries({ queryKey: ['users'] }) 
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const rightsMut = useMutation({
    mutationFn: (data) => updateUserRights(data),
    onSuccess: () => { 
      toast.success('Access updated'); 
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditingAccess(null) 
    },
    onError: (err) => toast.error(err.message),
  })

  const limitMut = useMutation({
    mutationFn: ({ id, max }) => updateUserLimit(id, max),
    onSuccess: () => { 
      toast.success('User limit updated'); 
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
      setEditingLimit(null) 
    },
    onError: (err) => toast.error(err.message),
  })

  const roleColors = { 'super_admin': 'bg-purple-50 text-purple-600', 'admin': 'bg-blue-50 text-blue-600', 'user': 'bg-slate-100 text-slate-500' }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Admin Panel</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {isSuperAdmin ? 'Super Admin — full system control' : `Admin — ${myGrantedUsers.length} / ${myMaxUsers} users granted`}
          </p>
        </div>
        <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isSuperAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
          {isSuperAdmin ? 'Super Admin' : 'Admin'}
        </span>
      </div>

      {/* Super Admin Dashboard Summary */}
      {isSuperAdmin && dashboardData && (
        <div className="grid grid-cols-3 gap-4 mb-6">
           <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Total Users</p>
                <p className="text-2xl font-bold text-slate-800">{dashboardData.total_users}</p>
              </div>
              <ShieldCheck className="w-8 h-8 text-slate-200" />
           </div>
           <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">Total Admins</p>
                <p className="text-2xl font-bold text-slate-800">{dashboardData.total_admins}</p>
              </div>
              <ShieldAlert className="w-8 h-8 text-purple-200" />
           </div>
        </div>
      )}

      {/* Super Admin: Admins List */}
      {isSuperAdmin && dashboardData?.admins?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
          <h4 className="text-base font-bold flex items-center gap-2 mb-4">
            <ShieldAlert className="w-5 h-5 text-purple-600" />
            Admin Quota Dashboard
          </h4>
          <div className="space-y-3">
            {dashboardData.admins.map(a => (
              <div key={a.login_id} className="border border-slate-100 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{a.identifier}</p>
                  <p className="text-xs text-slate-400">ID: {a.login_id}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-600 mb-1">Quota: {a.used_quota} / {a.max_user_quota}</div>
                  <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, a.quota_pct)}%` }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Grant Access Form */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h4 className="text-base font-bold flex items-center gap-2 mb-5">
            <UserPlus className="w-5 h-5 text-blue-600" />
            Grant Access
            {!isSuperAdmin && <span className="ml-auto text-xs text-slate-400 font-normal">{myGrantedUsers.length} / {myMaxUsers} slots used</span>}
          </h4>

          {!isSuperAdmin && myGrantedUsers.length >= myMaxUsers && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
              User limit reached ({myMaxUsers}). Contact Super Admin to increase.
            </div>
          )}

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
                  <option value="user">User</option>
                  {isSuperAdmin && <option value="admin">Admin</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {selectedRole === 'admin' ? 'All Sheets (Admin)' : 'Sheet Access'}
                </label>
                {selectedRole === 'admin' ? (
                  <div className="field-input bg-slate-50 text-slate-400 text-xs flex items-center">All sheets</div>
                ) : (
                  <select {...register('sheet_access')} multiple className="field-input h-20">
                    {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            </div>
            {isSuperAdmin && selectedRole === 'admin' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Max Users (for this Admin)</label>
                <input {...register('max_users')} type="number" defaultValue={10} min={1} max={100} className="field-input" />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
              <input {...register('notes')} placeholder="Optional admin notes" className="field-input" />
            </div>
            <button type="submit" disabled={grantMut.isPending || (!isSuperAdmin && myGrantedUsers.length >= myMaxUsers)}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-bold transition disabled:opacity-50 cursor-pointer">
              {grantMut.isPending ? 'Granting...' : 'Grant Access'}<Key className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* User List */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h4 className="text-base font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />Manage Users
            </h4>
            <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-bold">{users.length} Users</span>
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 skeleton rounded-lg" />)}</div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
              {users.map((u) => (
                <div key={u.login_id} className="border border-slate-100 rounded-lg p-3 hover:bg-slate-50 transition group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${roleColors[u.role] || 'bg-slate-100 text-slate-500'}`}>
                        {u.identifier?.charAt(0)?.toUpperCase() || 'U'}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{u.login_id}</p>
                        <p className="text-xs text-slate-400">{u.identifier}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${roleColors[u.role] || 'bg-slate-100 text-slate-500'}`}>{u.display_role || u.role}</span>
                      
                      {/* Only show reset/remove if we have rights. Admin can only manage users, not other admins. Super admin can manage all. */}
                      { (isSuperAdmin || (isAdmin && u.role === 'user' && u.created_by === user?.login_id)) && (
                        <>
                          <button onClick={() => { if (confirm('Reset password?')) resetMut.mutate(u.login_id) }}
                            className="w-7 h-7 rounded hover:bg-amber-50 text-amber-500 items-center justify-center hidden group-hover:flex" title="Reset Password">
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => { if (confirm(`Remove ${u.login_id}?`)) removeMut.mutate(u.login_id) }}
                            className="w-7 h-7 rounded hover:bg-red-50 text-red-500 items-center justify-center hidden group-hover:flex" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Sheet access display + edit */}
                  <div className="mt-2 pl-11">
                    {editingAccess === u.login_id ? (
                      <div className="flex items-start gap-2">
                        <select multiple defaultValue={u.sheet_access}
                          onChange={(e) => {
                            const vals = Array.from(e.target.selectedOptions, o => o.value)
                            rightsMut.mutate({ target_login_id: u.login_id, role: u.role, sheet_access: vals })
                          }}
                          className="text-xs border border-slate-200 rounded p-1 h-20 flex-1">
                          {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button onClick={() => setEditingAccess(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 flex-wrap">
                        {u.role === 'admin' || u.role === 'super_admin' ? (
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">All sheets</span>
                        ) : (
                          <>
                            {(u.sheet_access?.length ? u.sheet_access : ['No access']).map(s => (
                              <span key={s} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{s}</span>
                            ))}
                            {(isSuperAdmin || (isAdmin && u.role === 'user' && u.created_by === user?.login_id)) && (
                              <button onClick={() => setEditingAccess(u.login_id)} className="hidden group-hover:inline-flex items-center gap-0.5 text-[10px] text-blue-500 hover:underline ml-1">
                                <Edit2 className="w-3 h-3" />Edit
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {/* User limit for admins (Super Admin only) */}
                    {isSuperAdmin && u.role === 'admin' && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-slate-400">User limit:</span>
                        {editingLimit === u.login_id ? (
                          <>
                            <input type="number" value={limitValue} onChange={e => setLimitValue(e.target.value)}
                              className="w-16 text-xs border border-slate-200 rounded px-1 py-0.5" />
                            <button onClick={() => limitMut.mutate({ id: u.login_id, max: limitValue })}
                              className="text-green-500 hover:text-green-600"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setEditingLimit(null)} className="text-slate-400"><X className="w-3.5 h-3.5" /></button>
                          </>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-600 cursor-pointer hover:text-blue-500"
                            onClick={() => { setEditingLimit(u.login_id); setLimitValue(u.max_user_quota || '10') }}>
                            {u.max_user_quota || '10'} <Edit2 className="w-2.5 h-2.5 inline" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
