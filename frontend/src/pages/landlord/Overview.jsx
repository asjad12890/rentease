import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Building2, Users, Wrench, MessageSquare, DollarSign, Clock, AlertCircle, FileDown, BarChart2 } from 'lucide-react';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';

function StatCard({ label, value, sub, Icon, color, onClick }) {
  const colors = {
    blue:   { bg: 'bg-blue-50 border-blue-100',   val: 'text-blue-700',   icon: 'bg-blue-100 text-blue-600' },
    green:  { bg: 'bg-green-50 border-green-100',  val: 'text-green-700',  icon: 'bg-green-100 text-green-600' },
    orange: { bg: 'bg-orange-50 border-orange-100',val: 'text-orange-700', icon: 'bg-orange-100 text-orange-600' },
    red:    { bg: 'bg-red-50 border-red-100',      val: 'text-red-700',    icon: 'bg-red-100 text-red-600' },
  };
  const c = colors[color] || colors.blue;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick}
      className={`${c.bg} border rounded-2xl p-5 text-left w-full ${onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] transition' : ''}`}>
      {Icon && (
        <div className={`w-9 h-9 ${c.icon} rounded-xl flex items-center justify-center mb-3`}>
          <Icon size={18} />
        </div>
      )}
      <p className={`text-3xl font-bold ${c.val}`}>{value}</p>
      <p className="text-sm font-medium text-gray-700 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Tag>
  );
}

function FinCard({ label, value, Icon, color, onClick, sub }) {
  const colors = {
    green:  { bg: 'bg-green-50 border-green-100',  val: 'text-green-700',  icon: 'bg-green-100 text-green-600' },
    yellow: { bg: 'bg-yellow-50 border-yellow-100', val: 'text-yellow-700', icon: 'bg-yellow-100 text-yellow-600' },
    red:    { bg: 'bg-red-50 border-red-100',       val: 'text-red-700',    icon: 'bg-red-100 text-red-600' },
  };
  const c = colors[color] || colors.green;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick}
      className={`${c.bg} border rounded-2xl p-5 text-left w-full ${onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] transition' : ''}`}>
      {Icon && (
        <div className={`w-9 h-9 ${c.icon} rounded-xl flex items-center justify-center mb-3`}>
          <Icon size={18} />
        </div>
      )}
      <p className={`text-2xl font-bold ${c.val}`}>{value}</p>
      <p className="text-sm font-medium text-gray-700 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Tag>
  );
}

const fmtRs = (val) => `Rs ${Number(val).toLocaleString()}`;

function ChartCard({ title, children, isEmpty }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-4">{title}</h2>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-300 gap-2">
          <BarChart2 size={36} />
          <p className="text-sm">No data yet. Generate rent to see charts.</p>
        </div>
      ) : children}
    </div>
  );
}

export default function Overview() {
  const [stats, setStats] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [chartLoading, setChartLoading] = useState(true);
  const [rentChart, setRentChart] = useState([]);
  const [occChart, setOccChart] = useState([]);
  const [revChart, setRevChart] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/landlord/stats').then((r) => setStats(r.data)).catch(() => {});

    Promise.all([
      api.get('/landlord/chart/rent-collection').catch(() => ({ data: [] })),
      api.get('/landlord/chart/occupancy').catch(() => ({ data: [] })),
      api.get('/landlord/chart/revenue').catch(() => ({ data: [] })),
    ]).then(([rc, occ, rev]) => {
      setRentChart(rc.data || []);
      setOccChart(occ.data || []);
      setRevChart(rev.data || []);
    }).finally(() => setChartLoading(false));
  }, []);

  async function exportReport() {
    setExportingPdf(true);
    try {
      const res = await api.get('/landlord/export-pdf', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'landlord_report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    finally { setExportingPdf(false); }
  }

  if (!stats) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Loading...
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Overview</h1>
          <p className="text-sm text-gray-400 mt-1">Click any card for details</p>
        </div>
        <button onClick={exportReport} disabled={exportingPdf}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-60 border border-gray-200">
          {exportingPdf ? <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-600 rounded-full animate-spin" /> : <FileDown size={14} />}
          Export Report
        </button>
      </div>

      {/* Row 1: 3 operational stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Properties"
          value={stats.approved_properties || 0}
          Icon={Building2}
          color="blue"
          sub={`${stats.total_beds || 0} beds · ${stats.occupied_beds || 0} occupied${stats.pending_properties > 0 ? ` · ${stats.pending_properties} pending` : ''}`}
          onClick={() => navigate('/landlord/properties')}
        />
        <StatCard
          label="Active Tenants"
          value={stats.occupied_beds || 0}
          Icon={Users}
          color="green"
          sub={`${stats.total_beds || 0} total beds · ${stats.vacant_beds || 0} available`}
          onClick={() => navigate('/landlord/tenants')}
        />
        <StatCard
          label="Pending Maintenance"
          value={stats.pending_maintenance || 0}
          Icon={Wrench}
          color="orange"
          sub={stats.maintenance_by_priority && Object.keys(stats.maintenance_by_priority).length > 0
            ? Object.entries(stats.maintenance_by_priority).map(([p, c]) => `${p}: ${c}`).join(' · ')
            : 'No open requests'}
          onClick={() => navigate('/landlord/maintenance')}
        />
      </div>

      {/* Row 2: 3 pastel financial cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FinCard label="Monthly Revenue" value={`₨ ${(stats.monthly_revenue || 0).toLocaleString()}`} Icon={DollarSign} color="green" />
        <FinCard label="Pending Rent"    value={`₨ ${(stats.pending_rent    || 0).toLocaleString()}`} Icon={Clock}       color="yellow" />
        <FinCard
          label="Overdue Rent"
          value={`₨ ${(stats.overdue_rent || 0).toLocaleString()}`}
          Icon={AlertCircle}
          color="red"
          sub={stats.overdue_count > 0 ? `${stats.overdue_count} payment${stats.overdue_count > 1 ? 's' : ''} overdue — click to view` : undefined}
          onClick={stats.overdue_count > 0 ? () => navigate('/landlord/tenants') : undefined}
        />
      </div>

      {/* Row 3: Open complaints */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Open Complaints"
          value={stats.open_complaints || 0}
          Icon={MessageSquare}
          color="red"
          sub="Awaiting your response"
          onClick={() => navigate('/landlord/complaints')}
        />
      </div>

      {/* Analytics Charts */}
      {chartLoading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center gap-3 text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Loading charts...
        </div>
      ) : (
        <>
          {/* Chart 1: Rent Collection */}
          <ChartCard title="Rent Collection — Last 6 Months" isEmpty={!rentChart.some((d) => d.collected > 0 || d.pending > 0)}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rentChart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `Rs ${v / 1000}k` : `Rs ${v}`} tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(val) => fmtRs(val)} />
                <Legend />
                <Bar dataKey="collected" name="Collected" fill="#10B981" radius={[3,3,0,0]} />
                <Bar dataKey="pending"   name="Pending"   fill="#F59E0B" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 2: Occupancy Rate by Property */}
          <ChartCard title="Occupancy Rate by Property" isEmpty={occChart.length === 0}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={occChart} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="property" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={45} />
                <Tooltip formatter={(val) => [`${val}%`, 'Occupancy']} />
                <Bar dataKey="rate" name="Occupancy %" radius={[3,3,0,0]}
                  label={{ position: 'top', formatter: (v) => `${v}%`, fontSize: 11, fill: '#6B7280' }}>
                  {occChart.map((entry, index) => (
                    <Cell key={`occ-${index}`} fill={entry.rate >= 80 ? '#10B981' : entry.rate >= 50 ? '#3B82F6' : '#EF4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 3: Revenue vs Platform Fee */}
          <ChartCard title="Revenue vs Platform Fee — Last 6 Months" isEmpty={!revChart.some((d) => d.rent > 0 || d.fee > 0)}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={revChart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `Rs ${v / 1000}k` : `Rs ${v}`} tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(val) => fmtRs(val)} />
                <Legend />
                <Bar dataKey="rent" name="Rent Revenue" fill="#3B82F6" radius={[3,3,0,0]} />
                <Bar dataKey="fee"  name="Platform Fee" fill="#F97316" radius={[3,3,0,0]} />
                <Bar dataKey="net"  name="Net Profit"   radius={[3,3,0,0]}>
                  {revChart.map((entry, index) => (
                    <Cell key={`net-${index}`} fill={entry.net >= 0 ? '#10B981' : '#EF4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}

    </div>
  );
}
