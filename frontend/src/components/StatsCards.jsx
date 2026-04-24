import { useQuery } from '@tanstack/react-query'
import { getSheetSummary } from '../lib/api'
import * as mock from '../lib/mockData'
import { Users, UserCheck, UserPlus, FileSpreadsheet } from 'lucide-react'

export default function StatsCards() {
  const { data: rawData, isLoading, isError } = useQuery({
    queryKey: ['sheet-summary'],
    queryFn: getSheetSummary,
    retry: 1,
  })

  // Fallback to mock if API fails
  const data = isError ? mock.mockGetSheetSummary() : rawData

  // Handle both { sheets: [] } and [ { name: '', count: 0 } ]
  const sheets = Array.isArray(data) ? data : (data?.sheets || [])
  const total = data?.total ?? sheets.reduce((s, sh) => s + (sh.count || 0), 0)
  const verified = data?.total_verified ?? sheets.reduce((s, sh) => s + (sh.verified || 0), 0)

  const cards = [
    { label: 'Total Candidates', value: total, icon: Users, color: 'bg-blue-50 text-blue-600' },
    { label: 'Verified', value: verified, icon: UserCheck, color: 'bg-green-50 text-green-600' },
    { label: 'Added This Month', value: data?.added_this_month || 0, icon: UserPlus, color: 'bg-amber-50 text-amber-600' },
    { label: 'Active Sheets', value: sheets.length, icon: FileSpreadsheet, color: 'bg-teal-50 text-teal-600' },
  ]

  return (
    <div className="grid grid-cols-4 gap-5">
      {cards.map((c) => (
        <div key={c.label} className="bg-white border border-slate-200 rounded-xl p-5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${c.color}`}>
            <c.icon className="w-5 h-5" />
          </div>
          {isLoading ? (
            <div className="h-8 w-20 skeleton rounded mb-1" />
          ) : (
            <p className="text-2xl font-extrabold text-slate-800">{c.value.toLocaleString()}</p>
          )}
          <p className="text-xs text-slate-500 font-medium">{c.label}</p>
        </div>
      ))}
    </div>
  )
}
