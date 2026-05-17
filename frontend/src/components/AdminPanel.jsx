import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { grantAccessSchema } from '../lib/schemas'
import { getUsers, grantAccess, resetPassword, removeUser, getSheetSummary, updateUserRights, updateUserLimit, getAdminDashboard, apiFetch } from '../lib/api'
import { getSheets } from '../lib/mockData'
import useStore from '../lib/store'
import { toast } from 'sonner'
import { UserPlus, Key, Trash2, ShieldCheck, Edit2, Check, X, ShieldAlert, Send, ToggleLeft, ToggleRight } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import ResetPasswordModal from './ResetPasswordModal'
import EditProfileModal from './EditProfileModal'

export default function AdminPanel() {
  const { user, token } = useStore()
  const qc = useQueryClient()

  const rawRole = String(user?.role).toLowerCase().replace(/\s+/g, '_')
  const isSuperAdmin = rawRole === 'super_admin'
  const isAdmin = rawRole === 'admin' || isSuperAdmin

  const [editingAccess, setEditingAccess]   = useState(null)
  const [editingLimit, setEditingLimit]     = useState(null)
  const [limitValue, setLimitValue]         = useState('')
  const [showCreds, setShowCreds]           = useState(null)   // { login_id, password, email }

  // Modal state
  const [resetTarget,   setResetTarget]     = useState(null)   // user object for ResetPasswordModal
  const [confirmRemove, setConfirmRemove]   = useState(null)   // login_id string
  const [confirmToggle, setConfirmToggle]   = useState(null)   // { login_id, currentStatus }
  const [editingProfile, setEditingProfile] = useState(null)   // user object for EditProfileModal

  const { data: summaryData } = useQuery({ queryKey: ['sheet-summary'], queryFn: getSheetSummary })
  const sheets = summaryData?.sheets?.length ? summaryData.sheets.map((s) => s.name) : getSheets()

  const { data: usersData, isLoading, isError: usersError } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    placeholderData: { users: [] },
  })
  const users = usersData?.users || []

  const { data: dashboardData, isError: dashError } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: getAdminDashboard,
    enabled: isSuperAdmin,
  })

  if (usersError || dashError) {
    toast.error('Failed to load some admin data. Please check your permissions.')
  }

  // OAuth status
  const { data: oauthStatus } = useQuery({
    queryKey: ['google-oauth-status'],
    queryFn: () => apiFetch('/auth/google/status'),
    enabled: !!user,
  })

  const myGrantedUsers = users.filter(u => u.created_by === user?.login_id)
  const myMaxUsers = parseInt(user?.max_user_quota) || 10

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    resolver: zodResolver(grantAccessSchema),
    defaultValues: { role: 'user', sheet_access: [] },
  })
  const selectedRole = watch('role')

  const grantMut = useMutation({
    mutationFn: (data) => grantAccess({ ...data, created_by: user?.login_id }),
    onSuccess: (res) => {
      // Show credentials in a premium pop-up modal
      setShowCreds({ login_id: res.login_id, password: res.password, email: res.email || res.identifier })
      toast.success(res.message || 'Access granted successfully')
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
      reset()
    },
    onError: (err) => toast.error(err.message),
  })

  const removeMut = useMutation({
    mutationFn: (loginId) => removeUser(loginId, user?.login_id),
    onSuccess: () => {
      toast.success('User removed')
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
      setConfirmRemove(null)
    },
    onError: (err) => { toast.error(err.message); setConfirmRemove(null) },
  })

  const toggleMut = useMutation({
    mutationFn: ({ login_id, status }) =>
      apiFetch('/toggle-user-status', { method: 'PUT', body: JSON.stringify({ target_login_id: login_id, status }) }),
    onSuccess: (_, vars) => {
      toast.success(`User ${vars.status === 'active' ? 'activated' : 'deactivated'}`)
      qc.invalidateQueries({ queryKey: ['users'] })
      setConfirmToggle(null)
    },
    onError: (err) => { toast.error(err.message); setConfirmToggle(null) },
  })

  const rightsMut = useMutation({
    mutationFn: (data) => updateUserRights(data),
    onSuccess: () => { toast.success('Access updated'); qc.invalidateQueries({ queryKey: ['users'] }); setEditingAccess(null) },
    onError: (err) => toast.error(err.message),
  })

  const limitMut = useMutation({
    mutationFn: ({ id, max }) => updateUserLimit(id, max),
    onSuccess: () => {
      toast.success('User limit updated')
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
      setEditingLimit(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const roleColors = {
    super_admin: 'bg-purple-50 text-purple-600',
    admin: 'bg-blue-50 text-blue-600',
    user: 'bg-slate-100 text-slate-500',
  }

  return (
    <div className="space-y-6">
      {/* Modals */}
      {showCreds && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-6 relative overflow-hidden transform scale-in duration-200">
            {/* Background decoration */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
            
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 bg-green-50 rounded-full flex items-center justify-center border border-green-100 text-green-600">
                <ShieldCheck className="w-6 h-6 animate-pulse" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Access Granted Successfully!</h3>
              <p className="text-xs text-slate-400">
                The credentials have been generated and emailed to <strong className="text-slate-600 font-semibold">{showCreds.email}</strong>.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">Login ID</label>
                <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <span className="font-mono text-sm text-slate-700 select-all font-semibold">{showCreds.login_id}</span>
                  <button 
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(showCreds.login_id);
                      toast.success('Login ID copied to clipboard');
                    }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition cursor-pointer">
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">Password</label>
                <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <span className="font-mono text-sm text-slate-700 select-all font-semibold">{showCreds.password}</span>
                  <button 
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(showCreds.password);
                      toast.success('Password copied to clipboard');
                    }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition cursor-pointer">
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2 text-[11px] text-amber-700 leading-relaxed">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Important Notice:</span> Please copy these credentials to a safe place immediately. For security reasons, the password will not be shown again.
              </div>
            </div>

            <button 
              type="button"
              onClick={() => setShowCreds(null)}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer">
              I Have Copied the Credentials
            </button>
          </div>
        </div>
      )}

      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      <EditProfileModal user={editingProfile} onClose={() => setEditingProfile(null)} sheets={sheets} />

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove User"
        message={`This will permanently deactivate ${confirmRemove}. They will lose all access. Continue?`}
        confirmText="Remove"
        danger
        onConfirm={() => removeMut.mutateAsync(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={!!confirmToggle}
        title={confirmToggle?.currentStatus === 'active' ? 'Deactivate User' : 'Activate User'}
        message={`${confirmToggle?.currentStatus === 'active' ? 'Deactivate' : 'Activate'} user ${confirmToggle?.login_id}?`}
        confirmText={confirmToggle?.currentStatus === 'active' ? 'Deactivate' : 'Activate'}
        danger={confirmToggle?.currentStatus === 'active'}
        onConfirm={() => toggleMut.mutateAsync({
          login_id: confirmToggle.login_id,
          status: confirmToggle.currentStatus === 'active' ? 'inactive' : 'active',
        })}
        onClose={() => setConfirmToggle(null)}
      />

      {/* Header */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Admin Panel</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {isSuperAdmin ? 'Super Admin — full system control' : `Admin — ${myGrantedUsers.length} / ${myMaxUsers} users granted`}
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          {isAdmin && (
            <div className="flex items-center gap-2">
              {oauthStatus?.isLinked ? (
                <div className="flex items-center gap-2 bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-[11px] font-bold text-green-600">Google Linked: {oauthStatus.email}</span>
                </div>
              ) : (
                <a 
                  href={`${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/auth/google?token=${token}`}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Link Google Account
                </a>
              )}
            </div>
          )}
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isSuperAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
            {isSuperAdmin ? 'Super Admin' : 'Admin'}
          </span>
        </div>
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
            <ShieldAlert className="w-5 h-5 text-purple-600" />Admin Quota Dashboard
          </h4>
          <div className="space-y-3">
            {dashboardData?.admins?.map(a => (
              <div key={a.login_id} className="border border-slate-100 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{a.identifier}</p>
                  <p className="text-xs text-slate-400">ID: {a.login_id}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-600 mb-1">Quota: {a.used_quota} / {a.max_user_quota}</div>
                  <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, a.quota_pct)}%` }} />
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Email / Login ID *</label>
                <input {...register('identifier')} placeholder="user@example.com" className="field-input" />
                {errors.identifier && <p className="text-[11px] text-red-500 mt-0.5">{errors.identifier.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Phone Number</label>
                <input {...register('phone')} placeholder="+919876543210" className="field-input" />
              </div>
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
                  Sheet Access
                </label>
                <select {...register('sheet_access')} multiple className="field-input h-20">
                  {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">Hold Ctrl/Cmd to select multiple sheets.</p>
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
              {users.map((u) => {
                const canManage = isSuperAdmin || (isAdmin && u.role === 'user' && u.created_by === user?.login_id)
                const isActive = (u.status || 'active') === 'active'
                return (
                  <div key={u.login_id} className="border border-slate-100 rounded-xl p-3 hover:bg-slate-50 transition group">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${roleColors[u.role] || 'bg-slate-100 text-slate-500'}`}>
                          {u.identifier?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                            {u.login_id}
                            {!isActive && <span className="text-[10px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full font-medium">Inactive</span>}
                          </p>
                          <p className="text-xs text-slate-400">{u.identifier}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${roleColors[u.role] || 'bg-slate-100 text-slate-500'}`}>
                          {u.display_role || u.role}
                        </span>

                        {canManage && (
                          <>
                            {/* Edit Profile */}
                            <button
                              onClick={() => setEditingProfile(u)}
                              className="w-7 h-7 rounded-lg hover:bg-blue-50 text-blue-400 hover:text-blue-600 items-center justify-center hidden group-hover:flex transition"
                              title="Edit Profile">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            {/* Send Credentials */}
                            <button
                              onClick={() => setResetTarget(u)}
                              className="w-7 h-7 rounded-lg hover:bg-blue-50 text-blue-400 hover:text-blue-600 items-center justify-center hidden group-hover:flex transition"
                              title="Send Credentials">
                              <Send className="w-3.5 h-3.5" />
                            </button>

                            {/* Toggle Status */}
                            <button
                              onClick={() => setConfirmToggle({ login_id: u.login_id, currentStatus: u.status || 'active' })}
                              className="w-7 h-7 rounded-lg hover:bg-amber-50 text-amber-400 hover:text-amber-600 items-center justify-center hidden group-hover:flex transition"
                              title={isActive ? 'Deactivate' : 'Activate'}>
                              {isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                            </button>

                            {/* Remove */}
                            <button
                              onClick={() => setConfirmRemove(u.login_id)}
                              className="w-7 h-7 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 items-center justify-center hidden group-hover:flex transition"
                              title="Remove User">
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
                          {u.role === 'super_admin' ? (
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">All sheets</span>
                          ) : (
                            <>
                              {(u.sheet_access?.length ? u.sheet_access : ['No access']).map(s => (
                                <span key={s} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{s}</span>
                              ))}
                              {canManage && (
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
                              <button onClick={() => limitMut.mutate({ id: u.login_id, max: limitValue })} className="text-green-500 hover:text-green-600"><Check className="w-3.5 h-3.5" /></button>
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
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
