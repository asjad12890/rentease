import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building, UserCheck, Clock, TrendingUp, AlertTriangle,
  CheckCircle, Building2, X, DollarSign, UserPlus,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { BarChart2 } from 'lucide-react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import { fmtDate, fmtMonthYear, fmtCurrency } from '../../utils/format.jsx';

const BASE = 'http://localhost:8000';
const token = () => localStorage.getItem('token');
const authHeaders = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

function StatCard({ label, value, sub, Icon, color, onClick }) {
  const palettes = {
    blue:   { wrap: 'bg-white border-l-4 border-l-blue-500',   icon: 'bg-blue-50 text-blue-600',   val: 'text-gray-800' },
    green:  { wrap: 'bg-white border-l-4 border-l-green-500',  icon: 'bg-green-50 text-green-600',  val: 'text-gray-800' },
    purple: { wrap: 'bg-white border-l-4 border-l-purple-500', icon: 'bg-purple-50 text-purple-600', val: 'text-gray-800' },
    orange: { wrap: 'bg-white border-l-4 border-l-orange-400', icon: 'bg-orange-50 text-orange-500', val: 'text-gray-800' },
  };
  const p = palettes[color] || palettes.blue;
  return (
    <button onClick={onClick}
      className={`${p.wrap} rounded-xl shadow-sm border border-gray-100 p-5 text-left w-full hover:shadow-md hover:scale-[1.01] transition cursor-pointer`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 ${p.icon} rounded-lg flex items-center justify-center`}>
          <Icon size={20} />
        </div>
      </div>
      <p className={`text-2xl font-bold ${p.val}`}>{value}</p>
      <p className="text-sm text-gray-600 mt-1 font-medium">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </button>
  );
}

function RevenueCard({ label, value, sub, Icon, color }) {
  const palettes = {
    green:  { wrap: 'bg-white border-l-4 border-l-green-500',  icon: 'bg-green-50 text-green-600',  val: 'text-green-700' },
    yellow: { wrap: 'bg-white border-l-4 border-l-yellow-400', icon: 'bg-yellow-50 text-yellow-600', val: 'text-yellow-700' },
    blue:   { wrap: 'bg-white border-l-4 border-l-blue-500',   icon: 'bg-blue-50 text-blue-600',    val: 'text-blue-700' },
  };
  const p = palettes[color] || palettes.blue;
  return (
    <div className={`${p.wrap} rounded-xl shadow-sm border border-gray-100 p-5`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <div className={`w-8 h-8 ${p.icon} rounded-lg flex items-center justify-center`}>
          <Icon size={16} />
        </div>
      </div>
      <p className={`text-2xl font-bold ${p.val}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function PendingApprovalsModal({ onClose, onApproved }) {
  const [data, setData] = useState({ pending_landlords: [], pending_properties: [] });
  const [loading, setLoading] = useState(true);
  const [feeModal, setFeeModal] = useState(null);
  const [feeInput, setFeeInput] = useState('');
  const [approving, setApproving] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/admin/pending-approvals`, { headers: authHeaders() });
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function approveLandlord() {
    if (!feeModal) return;
    setApproving(feeModal.id);
    try {
      const res = await fetch(`${BASE}/admin/landlords/${feeModal.id}/approve`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ monthly_fee: parseFloat(feeInput) || 0 }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Error'); return; }
      setFeeModal(null);
      await load();
      onApproved();
    } finally { setApproving(null); }
  }

  async function approveProperty(pid) {
    setApproving(`prop-${pid}`);
    try {
      const res = await fetch(`${BASE}/admin/properties/${pid}/approve`, { method: 'PUT', headers: authHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Error'); return; }
      await load();
      onApproved();
    } finally { setApproving(null); }
  }

  const totalPending = data.pending_landlords.length + data.pending_properties.length;
  const allClear = !loading && totalPending === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-lg text-gray-800">Pending Approvals</h2>
            {!loading && <p className="text-xs text-gray-400 mt-0.5">{totalPending} item{totalPending !== 1 ? 's' : ''} awaiting review</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-3 text-gray-400 py-8">
              <Spinner small /> Loading...
            </div>
          ) : allClear ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                <CheckCircle size={32} className="text-green-500" />
              </div>
              <h3 className="font-semibold text-gray-700 text-lg">All caught up!</h3>
              <p className="text-gray-400 text-sm mt-1">No pending approvals at this time.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Pending Landlords */}
              <div>
                <h3 className="font-semibold text-gray-700 text-sm mb-3 flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">{data.pending_landlords.length}</span>
                  Pending Landlord Approvals
                </h3>
                {data.pending_landlords.length === 0 ? (
                  <p className="text-sm text-gray-400 italic py-2">None pending.</p>
                ) : (
                  <div className="space-y-2">
                    {[...data.pending_landlords].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((l) => (
                      <div key={l.id} className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-800 text-sm">{l.name}</p>
                          <p className="text-xs text-gray-500">{l.email}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Registered: {fmtDate(l.created_at) || '—'}</p>
                        </div>
                        <button onClick={() => { setFeeModal(l); setFeeInput(''); }}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700">
                          Approve
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pending Properties */}
              <div>
                <h3 className="font-semibold text-gray-700 text-sm mb-3 flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">{data.pending_properties.length}</span>
                  Pending Property Approvals
                </h3>
                {data.pending_properties.length === 0 ? (
                  <p className="text-sm text-gray-400 italic py-2">None pending.</p>
                ) : (
                  <div className="space-y-2">
                    {[...data.pending_properties].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((p) => (
                      <div key={p.id} className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-800 text-sm">{p.name}</p>
                          <p className="text-xs text-gray-500">By: {p.landlord_name}</p>
                          <p className="text-xs text-gray-400 mt-0.5 capitalize">
                            {(p.category || p.property_type || '').replace('_', ' ')} · Submitted: {fmtDate(p.created_at) || '—'}
                          </p>
                        </div>
                        <button onClick={() => approveProperty(p.id)} disabled={approving === `prop-${p.id}`}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 flex items-center gap-1.5 disabled:opacity-60">
                          {approving === `prop-${p.id}` && <Spinner small />} Approve
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition">
            Close
          </button>
        </div>

        {/* Fee sub-modal */}
        {feeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setFeeModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg text-gray-800">Approve Landlord</h3>
                <button onClick={() => setFeeModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>
              <p className="text-sm text-gray-600 mb-1 font-medium">{feeModal.business_name || feeModal.name}</p>
              <p className="text-sm text-gray-500 mb-4">Set the monthly platform fee. Enter 0 for no fee.</p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Fee (PKR)</label>
                <input type="number" min="0" value={feeInput} onChange={(e) => setFeeInput(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="e.g. 2000" autoFocus />
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setFeeModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={approveLandlord} disabled={!!approving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-2 disabled:opacity-60">
                  {approving && <Spinner small />} Approve
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const fmtRs = (val) => `Rs ${Number(val).toLocaleString()}`;

function ChartCard({ title, children, isEmpty }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="font-semibold text-gray-800 text-sm mb-4">{title}</h3>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-300 gap-2">
          <BarChart2 size={32} />
          <p className="text-sm">No data yet</p>
        </div>
      ) : children}
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [platformRevChart, setPlatformRevChart] = useState([]);
  const [growthChart, setGrowthChart] = useState([]);
  const [occupancyData, setOccupancyData] = useState(null);
  const [chartsLoading, setChartsLoading] = useState(true);
  const navigate = useNavigate();
  const [showPendingModal, setShowPendingModal] = useState(false);

  async function loadStats() {
    api.get('/admin/stats').then((r) => setStats(r.data)).catch(() => {});
  }

  async function loadChartData() {
    try {
      const res = await fetch(`${BASE}/admin/platform-payments`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const payments = await res.json();
      const monthly = {};
      payments.filter((p) => p.status === 'paid').forEach((p) => {
        monthly[p.month_year] = (monthly[p.month_year] || 0) + Number(p.amount);
      });
      const sorted = Object.entries(monthly)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([my, amt]) => ({ month: fmtMonthYear(my) || my, amount: amt }));
      setChartData(sorted);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadStats();
    loadChartData();
    Promise.all([
      api.get('/admin/chart/platform-revenue').catch(() => ({ data: [] })),
      api.get('/admin/chart/landlord-growth').catch(() => ({ data: [] })),
      api.get('/admin/chart/occupancy').catch(() => ({ data: null })),
    ]).then(([rev, growth, occ]) => {
      setPlatformRevChart(rev.data || []);
      setGrowthChart(growth.data || []);
      setOccupancyData(occ.data || null);
    }).finally(() => setChartsLoading(false));
  }, []);

  if (!stats) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Loading dashboard...
      </div>
    );
  }

  const pendingTotal = (stats.pending_landlords || 0) + (stats.pending_properties || 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Platform Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">Real-time stats across all landlords</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Landlords" value={stats.landlords} sub="Active accounts"
          Icon={Users} color="blue" onClick={() => navigate('/admin/landlords')} />
        <StatCard label="Total Properties" value={stats.properties} sub="Approved"
          Icon={Building} color="green" onClick={() => navigate('/admin/properties')} />
        <StatCard label="Active Tenants" value={stats.tenants} sub="Currently renting"
          Icon={UserCheck} color="purple" onClick={() => navigate('/admin/tenants')} />
        <StatCard
          label="Pending Approvals"
          value={pendingTotal}
          sub={pendingTotal > 0 ? `${stats.pending_landlords} landlords · ${stats.pending_properties} properties` : 'All clear'}
          Icon={AlertTriangle}
          color="orange"
          onClick={() => setShowPendingModal(true)}
        />
      </div>

      {/* Revenue cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <RevenueCard label="Platform Revenue This Month"
          value={fmtCurrency(stats.platform_revenue_this_month)}
          sub="Platform fees received this month"
          Icon={TrendingUp} color="green" />
        <RevenueCard label="Total Pending Fees"
          value={fmtCurrency(stats.total_pending_fees)}
          sub="Awaiting payment from landlords"
          Icon={Clock} color="yellow" />
        <RevenueCard label="Total Received All Time"
          value={fmtCurrency(stats.total_received)}
          sub="Cumulative platform revenue"
          Icon={DollarSign} color="blue" />
      </div>

      {/* Revenue trend chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-800 mb-1">Platform Revenue History</h3>
        <p className="text-xs text-gray-400 mb-4">Monthly platform fees collected (last 6 months)</p>
        {chartData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <TrendingUp size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No revenue data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₨${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [`₨ ${Number(v).toLocaleString()}`, 'Revenue']} />
              <Bar dataKey="amount" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Analytics Charts */}
      {chartsLoading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-center gap-3 text-gray-400">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Loading analytics...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Chart 1: Platform Fee Revenue */}
          <ChartCard title="Platform Fee Revenue — Last 6 Months" isEmpty={!platformRevChart.some((d) => d.collected > 0 || d.pending > 0)}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={platformRevChart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `Rs ${v / 1000}k` : `Rs ${v}`} tick={{ fontSize: 11 }} width={72} />
                <Tooltip formatter={(val) => fmtRs(val)} />
                <Legend />
                <Bar dataKey="collected" name="Collected" fill="#10B981" radius={[3,3,0,0]} />
                <Bar dataKey="pending"   name="Pending"   fill="#F59E0B" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 2: Landlord Growth */}
          <ChartCard title="New Landlords — Last 6 Months" isEmpty={growthChart.length === 0 || !growthChart.some((d) => d.new_landlords > 0)}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={growthChart} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
                <Tooltip formatter={(val) => [val, 'New Landlords']} />
                <Bar dataKey="new_landlords" name="New Landlords" fill="#2563EB" radius={[3,3,0,0]}
                  label={{ position: 'top', fontSize: 11, fill: '#6B7280' }} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 3: Platform-wide Occupancy */}
          {occupancyData && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-semibold text-gray-800 text-sm mb-4">Platform-wide Occupancy</h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center bg-gray-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-gray-800">{occupancyData.total_beds}</p>
                  <p className="text-xs text-gray-500 mt-1">Total Beds</p>
                </div>
                <div className="text-center bg-green-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-green-700">{occupancyData.occupied}</p>
                  <p className="text-xs text-gray-500 mt-1">Occupied</p>
                </div>
                <div className="text-center bg-gray-50 rounded-xl p-4">
                  <p className="text-2xl font-bold text-gray-500">{occupancyData.vacant}</p>
                  <p className="text-xs text-gray-500 mt-1">Vacant</p>
                </div>
              </div>
              {occupancyData.total_beds > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Occupancy Rate</span>
                    <span>{Math.round((occupancyData.occupied / occupancyData.total_beds) * 100)}%</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${Math.round((occupancyData.occupied / occupancyData.total_beds) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{occupancyData.properties} propert{occupancyData.properties !== 1 ? 'ies' : 'y'} · {occupancyData.landlords} landlord{occupancyData.landlords !== 1 ? 's' : ''}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showPendingModal && (
        <PendingApprovalsModal
          onClose={() => setShowPendingModal(false)}
          onApproved={loadStats}
        />
      )}
    </div>
  );
}
