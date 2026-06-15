import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { grantAccessSchema } from '../lib/schemas'
import { getUsers, grantAccess, resetPassword, removeUser, getSpreadsheets, updateUserRights, updateUserLimit, getAdminDashboard, apiFetch, sanitizeObject } from '../lib/api'
import useStore from '../lib/store'
import { toast } from 'sonner'
import { UserPlus, Key, Trash2, ShieldCheck, Edit2, Check, X, ShieldAlert, Send, ToggleLeft, ToggleRight, Database, Lock, Globe } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import ResetPasswordModal from './ResetPasswordModal'
import EditProfileModal from './EditProfileModal'

export default function AdminPanel() {
  const { user, token } = useStore()
  const qc = useQueryClient()

  const rawRole = String(user?.role).toLowerCase().replace(/\s+/g, '_')
  const isSuperAdmin = rawRole === 'super_admin'
  const isAdmin = rawRole === 'admin' || isSuperAdmin

  const [editingProfile, setEditingProfile] = useState(null)
  const [editingLimit, setEditingLimit]     = useState(null)
  const [limitValue, setLimitValue]         = useState('')
  const [showCreds, setShowCreds]           = useState(null)
  const [resetTarget, setResetTarget]       = useState(null)
  const [confirmRemove, setConfirmRemove]   = useState(null)
  const [confirmToggle, setConfirmToggle]   = useState(null)
  const [togglingAccess, setTogglingAccess] = useState({}) // { loginId_sheet: true }

  // Get ALL spreadsheets (admins need to see all to grant access)
  const { data: spreadsheetsData } = useQuery({
    queryKey: ['spreadsheets'],
    queryFn: getSpreadsheets,
    placeholderData: [],
  })
  const sheets = Array.isArray(spreadsheetsData)
    ? spreadsheetsData.filter(s => s.is_active).map(s => s.name)
    : []

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    placeholderData: { users: [] },
  })
  const users = usersData?.users || []

  const { data: dashboardData } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: getAdminDashboard,
    enabled: isSuperAdmin,
  })

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
  const selectedSheets = watch('sheet_access') || []

  const grantMut = useMutation({
    mutationFn: (data) => grantAccess({ ...data, created_by: user?.login_id }),
    onSuccess: (res) => {
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
    onSuccess: () => {
      toast.success('Sheet access updated')
      qc.invalidateQueries({ queryKey: ['users'] })
    },
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

  // Toggle a single sheet for a user — instant one-click
  const toggleSheetAccess = async (targetUser, sheet) => {
    const key = `${targetUser.login_id}_${sheet}`
    if (togglingAccess[key]) return
    const hasAccess = (targetUser.sheet_access || []).includes(sheet)
    const updated = hasAccess
      ? (targetUser.sheet_access || []).filter(s => s !== sheet)
      : [...(targetUser.sheet_access || []), sheet]
    setTogglingAccess(prev => ({ ...prev, [key]: true }))
    try {
      await rightsMut.mutateAsync({ target_login_id: targetUser.login_id, role: targetUser.role, sheet_access: updated })
    } finally {
      setTogglingAccess(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  const roleColors = {
    super_admin: 'bg-purple-50 text-purple-600',
    admin: 'bg-blue-50 text-blue-600',
    user: 'bg-slate-100 text-slate-500',
  }

  return (
    <div className="space-y-6">
      {/* Credentials modal */}
      {showCreds && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 bg-green-50 rounded-full flex items-center justify-center border border-green-100 text-green-600">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Access Granted!</h3>
              <p className="text-xs text-slate-400">Credentials emailed to <strong className="text-slate-600">{showCreds.email}</strong></p>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
              {[['Login ID', showCreds.login_id], ['Password', showCreds.password]].map(([label, val]) => (
                <div key={label}>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">{label}</label>
                  <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <span className="font-mono text-sm text-slate-700 select-all font-semibold">{val}</span>
                    <button type="button" onClick={() => { navigator.clipboard.writeText(val); toast.success(`${label} copied`) }}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition cursor-pointer">
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2 text-[11px] text-amber-700">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span><strong>Important:</strong> Save these credentials now — the password won't be shown again.</span>
            </div>
            <button type="button" onClick={() => setShowCreds(null)}
              className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer">
              I've Saved the Credentials
            </button>
          </div>
        </div>
      )}

      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
      <EditProfileModal user={editingProfile} onClose={() => setEditingProfile(null)} sheets={sheets} />

      <ConfirmDialog open={!!confirmRemove} title="Remove User"
        message={`Permanently deactivate ${confirmRemove}? They will lose all access.`}
        confirmText="Remove" danger
        onConfirm={() => removeMut.mutateAsync(confirmRemove)}
        onClose={() => setConfirmRemove(null)} />

      <ConfirmDialog open={!!confirmToggle}
        title={confirmToggle?.currentStatus === 'active' ? 'Deactivate User' : 'Activate User'}
        message={`${confirmToggle?.currentStatus === 'active' ? 'Deactivate' : 'Activate'} user ${confirmToggle?.login_id}?`}
        confirmText={confirmToggle?.currentStatus === 'active' ? 'Deactivate' : 'Activate'}
        danger={confirmToggle?.currentStatus === 'active'}
        onConfirm={() => toggleMut.mutateAsync({ login_id: confirmToggle.login_id, status: confirmToggle.currentStatus === 'active' ? 'inactive' : 'active' })}
        onClose={() => setConfirmToggle(null)} />

      {/* Header */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Admin Panel</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {isSuperAdmin ? 'Super Admin — full system control' : `Admin — ${myGrantedUsers.length} / ${myMaxUsers} users managed`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            oauthStatus?.isLinked ? (
              <div className="flex items-center gap-2 bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[11px] font-bold text-green-600">Google: {oauthStatus.email}</span>
              </div>
            ) : (
              <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/auth/google?token=${token}`}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold transition">
                <ShieldAlert className="w-4 h-4 text-amber-400" />Link Google Account
              </a>
            )
          )}
          <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isSuperAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
            {isSuperAdmin ? 'Super Admin' : 'Admin'}
          </span>
        </div>
      </div>

      {/* Super Admin dashboard */}
      {isSuperAdmin && dashboardData && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
            <div><p className="text-xs font-semibold text-slate-500">Total Users</p><p className="text-2xl font-bold text-slate-800">{dashboardData.total_users}</p></div>
            <ShieldCheck className="w-8 h-8 text-slate-200" />
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
            <div><p className="text-xs font-semibold text-slate-500">Total Admins</p><p className="text-2xl font-bold text-slate-800">{dashboardData.total_admins}</p></div>
            <ShieldAlert className="w-8 h-8 text-purple-200" />
          </div>
        </div>
      )}

      {isSuperAdmin && dashboardData?.admins?.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h4 className="text-base font-bold flex items-center gap-2 mb-4">
            <ShieldAlert className="w-5 h-5 text-purple-600" />Admin Quota Dashboard
          </h4>
          <div className="space-y-3">
            {dashboardData.admins.map(a => (
              <div key={a.login_id} className="border border-slate-100 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{a.identifier}</p>
                  <p className="text-xs text-slate-400">ID: {a.login_id}</p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-600 mb-1">{a.used_quota} / {a.max_user_quota} users</div>
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
        {/* ── Grant Access Form ── */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h4 className="text-base font-bold flex items-center gap-2 mb-5">
            <UserPlus className="w-5 h-5 text-blue-600" />Grant Access
            {!isSuperAdmin && <span className="ml-auto text-xs text-slate-400 font-normal">{myGrantedUsers.length} / {myMaxUsers} slots</span>}
          </h4>

          {!isSuperAdmin && myGrantedUsers.length >= myMaxUsers && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
              User limit reached ({myMaxUsers}). Contact Super Admin to increase.
            </div>
          )}

          <form onSubmit={handleSubmit((d) => grantMut.mutate(d))} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Full Name *</label>
              <input {...register('name')} placeholder="e.g. Ruchi Joshi" className="field-input" />
              {errors.name && <p className="text-[11px] text-red-500 mt-0.5">{errors.name.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Email / Login ID *</label>
                <input {...register('identifier')} placeholder="user@example.com" className="field-input" />
                {errors.identifier && <p className="text-[11px] text-red-500 mt-0.5">{errors.identifier.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Phone</label>
                <input {...register('phone')} placeholder="+919876543210" className="field-input" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Role *</label>
              <select {...register('role')} className="field-input">
                <option value="user">User</option>
                {isSuperAdmin && <option value="admin">Admin</option>}
              </select>
            </div>

            {isSuperAdmin && selectedRole === 'admin' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Max Users (for this Admin)</label>
                <input {...register('max_users')} type="number" defaultValue={10} min={1} max={100} className="field-input" />
              </div>
            )}

            {/* Sheet Access — toggle cards */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-500">Sheet Access</label>
                {selectedSheets.length > 0 && (
                  <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold">
                    {selectedSheets.length} selected
                  </span>
                )}
              </div>
              {sheets.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic p-3 border border-dashed border-slate-200 rounded-lg">
                  No spreadsheets connected yet. Add one in Spreadsheet Manager.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {sheets.map((s) => {
                    const checked = selectedSheets.includes(s)
                    return (
                      <label key={s}
                        className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${
                          checked ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-150 hover:bg-slate-50 hover:border-slate-200'
                        }`}>
                        <input type="checkbox" value={s} {...register('sheet_access')}
                          className="sr-only" />
                        <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all ${
                          checked ? 'bg-blue-600 border-blue-600' : 'border-2 border-slate-300 bg-white'
                        }`}>
                          {checked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        </div>
                        <Database className={`w-3.5 h-3.5 shrink-0 ${checked ? 'text-blue-500' : 'text-slate-400'}`} />
                        <span className={`text-xs font-medium flex-1 ${checked ? 'text-blue-700' : 'text-slate-700'}`}>{s}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
              <input {...register('notes')} placeholder="Optional admin notes" className="field-input" />
            </div>

            <button type="submit"
              disabled={grantMut.isPending || (!isSuperAdmin && myGrantedUsers.length >= myMaxUsers)}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-bold transition disabled:opacity-50 cursor-pointer">
              {grantMut.isPending ? 'Granting...' : <><Key className="w-4 h-4" />Grant Access</>}
            </button>
          </form>
        </div>

        {/* ── Manage Users ── */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <h4 className="text-base font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />Manage Users
            </h4>
            <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-bold">{users.length} Users</span>
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 skeleton rounded-xl" />)}</div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => {
                const canManage = isSuperAdmin || (isAdmin && u.role === 'user' && u.created_by === user?.login_id)
                const isActive = (u.status || 'active') === 'active'
                const targetRole = String(u.role).toLowerCase().replace(/\s+/g, '_')
                const isTargetAdmin = targetRole === 'admin'
                const isTargetSuperAdmin = targetRole === 'super_admin'
                const hasFullAccess = isTargetSuperAdmin

                return (
                  <div key={u.login_id} className="border border-slate-100 rounded-xl p-3 hover:bg-slate-50/50 transition group">
                    {/* User header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${roleColors[u.role] || 'bg-slate-100 text-slate-500'}`}>
                          {u.identifier?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                            {u.login_id}
                            {!isActive && <span className="text-[10px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">Inactive</span>}
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
                            <button onClick={() => setEditingProfile(u)}
                              className="w-7 h-7 rounded-lg hover:bg-blue-50 text-blue-400 hover:text-blue-600 items-center justify-center hidden group-hover:flex transition" title="Edit Profile">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setResetTarget(u)}
                              className="w-7 h-7 rounded-lg hover:bg-blue-50 text-blue-400 hover:text-blue-600 items-center justify-center hidden group-hover:flex transition" title="Send Credentials">
                              <Send className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setConfirmToggle({ login_id: u.login_id, currentStatus: u.status || 'active' })}
                              className="w-7 h-7 rounded-lg hover:bg-amber-50 text-amber-400 hover:text-amber-600 items-center justify-center hidden group-hover:flex transition"
                              title={isActive ? 'Deactivate' : 'Activate'}>
                              {isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => setConfirmRemove(u.login_id)}
                              className="w-7 h-7 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 items-center justify-center hidden group-hover:flex transition" title="Remove User">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Sheet access row */}
                    <div className="mt-2.5 pl-11">
                      {hasFullAccess ? (
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3 h-3 text-purple-400" />
                          <span className="text-[10px] text-purple-600 font-semibold">
                            {isTargetSuperAdmin ? 'Super Admin — All Sheets' : 'Admin — All Sheets'}
                          </span>
                        </div>
                      ) : sheets.length === 0 ? (
                        <span className="text-[10px] text-slate-400 italic">No sheets registered</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {sheets.map(sheet => {
                            const hasAccess = (u.sheet_access || []).includes(sheet)
                            const key = `${u.login_id}_${sheet}`
                            const isToggling = !!togglingAccess[key]
                            return (
                              <button key={sheet}
                                onClick={() => canManage && toggleSheetAccess(u, sheet)}
                                disabled={!canManage || isToggling}
                                title={canManage ? (hasAccess ? `Remove access to ${sheet}` : `Grant access to ${sheet}`) : sheet}
                                className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border transition-all ${
                                  hasAccess
                                    ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200'
                                    : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-blue-50 hover:text-blue-500 hover:border-blue-200'
                                } ${canManage ? 'cursor-pointer' : 'cursor-default'} ${isToggling ? 'opacity-50' : ''}`}>
                                {isToggling ? (
                                  <span className="inline-block w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
                                ) : hasAccess ? (
                                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                                ) : (
                                  <span className="text-[9px]">+</span>
                                )}
                                {sheet}
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {/* User quota for admins */}
                      {isSuperAdmin && isTargetAdmin && (
                        <div className="mt-1.5 flex items-center gap-2">
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
