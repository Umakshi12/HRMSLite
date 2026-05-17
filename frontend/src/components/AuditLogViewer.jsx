import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { ScrollText, ChevronLeft, ChevronRight, RefreshCw, User, Clock, Tag, FileText } from 'lucide-react'

const ACTION_COLORS = {
  ROW_CREATED:      'bg-emerald-100 text-emerald-700',
  ROW_UPDATED:      'bg-blue-100 text-blue-700',
  ROW_DELETED:      'bg-red-100 text-red-700',
  USER_ACTIVATED:   'bg-green-100 text-green-700',
  USER_DEACTIVATED: 'bg-orange-100 text-orange-700',
  USER_CREATED:     'bg-indigo-100 text-indigo-700',
  ACCESS_GRANTED:   'bg-teal-100 text-teal-700',
  ACCESS_REVOKED:   'bg-rose-100 text-rose-700',
  UNKNOWN:          'bg-slate-100 text-slate-600',
}

function badge(action) {
  const cls = ACTION_COLORS[action] || ACTION_COLORS.UNKNOWN
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{action}</span>
}

function timeAgo(dateStr) {
  if (!dateStr) return 'N/A'
  const parsed = new Date(dateStr)
  if (isNaN(parsed.getTime())) return 'N/A'

  const diff = Date.now() - parsed.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function AuditLogViewer() {
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState(null)
  const limit = 25

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => apiFetch(`/audit-logs?page=${page}&limit=${limit}`),
    placeholderData: { logs: [], total: 0, pages: 1 },
    keepPreviousData: true,
  })

  const logs = data?.logs || []
  const totalPages = data?.pages || 1

  return (
    <div className="flex-1 flex flex-col bg-slate-50 min-h-0">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
            <ScrollText className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Audit Logs</h1>
            <p className="text-xs text-slate-500">{data?.total || 0} total events — immutable Postgres record</p>
          </div>
        </div>
        <button onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition">
          <RefreshCw className="w-4 h-4" />Refresh
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading audit logs…</div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
            <ScrollText className="w-8 h-8 opacity-30" />
            <p className="text-sm">No audit events yet.</p>
            <p className="text-xs">Events are recorded as users create, edit, and delete rows.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-slate-300 transition">
                <button className="w-full text-left px-4 py-3 flex items-center gap-3"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600 shrink-0">
                    {(log.actor_name || 'S').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {badge(log.action_type)}
                      {log.target_tab_name && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <FileText className="w-3 h-3" />{log.target_tab_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      by <strong>{log.actor_name}</strong>
                      {log.metadata?.details && ` · ${log.metadata.details}`}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400 shrink-0">{timeAgo(log.timestamp || log.created_at)}</span>
                </button>

                {/* Expanded snapshot diff */}
                {expanded === log.id && (log.before_snapshot || log.after_snapshot) && (
                  <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 grid grid-cols-2 gap-3">
                    {log.before_snapshot && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Before</p>
                        <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-all bg-white rounded-lg p-2 border border-slate-200 max-h-40 overflow-auto">
                          {JSON.stringify(log.before_snapshot, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.after_snapshot && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">After</p>
                        <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-all bg-white rounded-lg p-2 border border-slate-200 max-h-40 overflow-auto">
                          {JSON.stringify(log.after_snapshot, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.ip_address && (
                      <p className="col-span-2 text-[10px] text-slate-400">IP: {log.ip_address}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
              <ChevronLeft className="w-4 h-4" />Prev
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Next<ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
