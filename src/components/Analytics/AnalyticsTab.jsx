import React, { useState, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, Mail, Reply, XCircle, Target } from 'lucide-react'
import { generateAnalyticsData, campaignStats } from '../../lib/mockData'

const analyticsData = generateAnalyticsData()

const METRICS = [
  { key: 'openRate', label: 'Open Rate', color: '#1B6EF3', icon: Mail, suffix: '%' },
  { key: 'replyRate', label: 'Reply Rate', color: '#10B981', icon: Reply, suffix: '%' },
  { key: 'bounceRate', label: 'Bounce Rate', color: '#EF4444', icon: XCircle, suffix: '%' },
  { key: 'conversionRate', label: 'Conversion Rate', color: '#8B5CF6', icon: Target, suffix: '%' },
]

function StatCard({ metric, data }) {
  const latest = data[data.length - 1]?.[metric.key] || 0
  const prev = data[data.length - 8]?.[metric.key] || 0
  const delta = latest - prev
  const positive = metric.key === 'bounceRate' ? delta < 0 : delta > 0
  const Icon = metric.icon

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: metric.color + '15' }}>
          <Icon size={16} style={{ color: metric.color }} />
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
          delta === 0 ? 'bg-gray-100 text-muted' :
          positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
        }`}>
          {delta === 0 ? <Minus size={10} /> : positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {Math.abs(delta).toFixed(1)}{metric.suffix}
        </span>
      </div>
      <div className="text-2xl font-display font-semibold text-dark">{latest.toFixed(1)}{metric.suffix}</div>
      <div className="text-xs text-muted mt-0.5">{metric.label}</div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl shadow-modal border border-gray-100 px-3 py-2 text-xs">
      <p className="font-medium text-dark mb-1.5">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted">{p.name}:</span>
          <span className="font-medium text-dark">{p.value.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsTab() {
  const [range, setRange] = useState(30)
  const [activeMetrics, setActiveMetrics] = useState(METRICS.map(m => m.key))

  const data = useMemo(() => analyticsData.slice(-range), [range])

  const toggleMetric = (key) => {
    setActiveMetrics(prev =>
      prev.includes(key) ? (prev.length > 1 ? prev.filter(m => m !== key) : prev) : [...prev, key]
    )
  }

  return (
    <div className="p-6 animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-semibold text-dark">Analytics</h1>
          <p className="text-sm text-muted mt-0.5">Performance overview across all campaigns</p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${range === d ? 'bg-primary text-white' : 'text-muted hover:text-dark'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {METRICS.map(m => <StatCard key={m.key} metric={m} data={data} />)}
      </div>

      {/* Chart */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-dark">Performance over time</h2>
          <div className="flex items-center gap-2">
            {METRICS.map(m => (
              <button
                key={m.key}
                onClick={() => toggleMetric(m.key)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  activeMetrics.includes(m.key)
                    ? 'border-transparent text-white font-medium'
                    : 'border-gray-200 text-muted'
                }`}
                style={activeMetrics.includes(m.key) ? { backgroundColor: m.color } : {}}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#5E7B97' }}
              tickLine={false}
              axisLine={false}
              interval={Math.ceil(data.length / 6) - 1}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#5E7B97' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            {METRICS.filter(m => activeMetrics.includes(m.key)).map(m => (
              <Line
                key={m.key}
                type="monotone"
                dataKey={m.key}
                name={m.label}
                stroke={m.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Volume bar chart */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-dark mb-4">Emails sent</h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#5E7B97' }} tickLine={false} axisLine={false} interval={Math.ceil(data.length / 6) - 1} />
            <YAxis tick={{ fontSize: 11, fill: '#5E7B97' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
            <Bar dataKey="sent" name="Emails sent" fill="#1B6EF3" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Per-campaign table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-dark">Per-campaign performance</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/60">
              <th className="text-left px-5 py-3 text-xs font-medium text-muted">Campaign</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-muted">Sent</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-muted">Opens</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-muted">Open rate</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-muted">Replies</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-muted">Reply rate</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-muted">Bounces</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {campaignStats.map(c => (
              <tr key={c.id} className="hover:bg-gray-50/40 transition-colors">
                <td className="px-5 py-3 font-medium text-dark">{c.name}</td>
                <td className="px-5 py-3 text-right text-muted">{c.sent.toLocaleString()}</td>
                <td className="px-5 py-3 text-right text-muted">{c.opens.toLocaleString()}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`font-medium ${c.openRate >= 35 ? 'text-emerald-600' : c.openRate >= 25 ? 'text-amber-600' : 'text-red-500'}`}>
                    {c.openRate}%
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-muted">{c.replies}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`font-medium ${c.replyRate >= 8 ? 'text-emerald-600' : c.replyRate >= 5 ? 'text-amber-600' : 'text-red-500'}`}>
                    {c.replyRate}%
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-muted">{c.bounces}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
