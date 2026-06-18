import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, DollarSign, Clock, CheckCircle, ExternalLink, FileDown,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Spinner from '../../components/Spinner';
import { fmtMonthYear, fmtDate, toTitleCase, fmtCurrency } from '../../utils/format.jsx';

import { BASE_URL as BASE } from '../../api/config';
const token = () => localStorage.getItem('token');
const authHeaders = () => ({
  'Authorization': `Bearer ${token()}`,
  'Content-Type': 'application/json',
});

function StatCard({ label, value, sub, Icon, color }) {
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

export default function AdminRevenue() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [allPayments, setAllPayments] = useState([]);
  const [pendingVerifications, setPendingVerifications] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [verifying, setVerifying] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  async function load() {
    setError('');
    try {
      const [revRes, pmtRes] = await Promise.all([
        fetch(`${BASE}/admin/revenue`, { headers: authHeaders() }),
        fetch(`${BASE}/admin/platform-payments`, { headers: authHeaders() }),
      ]);
      if (revRes.status === 401) { setError('401 - Not authenticated'); return; }
      if (revRes.status === 403) { setError('403 - Not authorized'); return; }
      if (!revRes.ok) { setError(`Error: ${revRes.status}`); return; }
      const d = await revRes.json();
      setData(d);
      if (pmtRes.ok) {
        const pmts = await pmtRes.json();
        setAllPayments(pmts);
        setPendingVerifications(pmts.filter((p) => p.status === 'pending_verification'));
        // Build chart from paid payments
        const monthly = {};
        pmts.filter((p) => p.status === 'paid').forEach((p) => {
          monthly[p.month_year] = (monthly[p.month_year] || 0) + Number(p.amount);
        });
        const sorted = Object.entries(monthly)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-6)
          .map(([my, amt]) => ({ month: fmtMonthYear(my) || my, amount: amt }));
        setChartData(sorted);
      }
    } catch (e) {
      setError(`Network error: ${e.message}`);
    }
  }

  async function verifyPayment(pid, action) {
    setVerifying(pid);
    const removed = pendingVerifications.find((p) => p.id === pid);
    if (action === 'confirm') {
      setPendingVerifications((prev) => prev.filter((p) => p.id !== pid));
    }
    try {
      const res = await fetch(`${BASE}/admin/platform-payments/${pid}/verify`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        if (removed) setPendingVerifications((prev) => [...prev, removed]);
        const d = await res.json().catch(() => ({}));
        alert(d.detail || 'Error');
        return;
      }
      await load();
    } finally { setVerifying(null); }
  }

  useEffect(() => { load(); }, []);

  async function downloadPlatformReport() {
    setExportingPdf(true);
    try {
      const res = await fetch(`${BASE}/admin/export-pdf`, { headers: authHeaders() });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'platform_report.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    finally { setExportingPdf(false); }
  }

  async function generateBills() {
    const month = new Date().toISOString().slice(0, 7);
    setGenerating(true); setGenMsg('');
    try {
      const res = await fetch(`${BASE}/admin/platform-payments/generate`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ month_year: month }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setGenMsg(d.detail || `Error: ${res.status}`); return; }
      setGenMsg(`Generated ${d.created} bill(s) for ${d.month_year}`);
      await load();
    } finally { setGenerating(false); }
  }

  // Filter breakdown by date range (filter landlords that have payments in range)
  const filteredBreakdown = data?.landlord_breakdown ? (() => {
    let breakdown = [...data.landlord_breakdown].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (fromDate || toDate) {
      const relevantLandlordIds = new Set(
        allPayments
          .filter((p) => {
            const d = p.paid_at?.split('T')[0] || p.created_at?.split('T')[0];
            if (!d) return false;
            if (fromDate && d < fromDate) return false;
            if (toDate && d > toDate) return false;
            return true;
          })
          .map((p) => p.landlord_id)
      );
      breakdown = breakdown.filter((l) => relevantLandlordIds.has(l.id));
    }
    return breakdown;
  })() : [];

  if (error) return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Platform Revenue</h1>
      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <p className="text-red-700 font-medium mb-1">Failed to load</p>
        <p className="text-red-600 text-sm font-mono mb-4">{error}</p>
        <button onClick={load} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Retry</button>
      </div>
    </div>
  );

  if (!data) return (
    <div className="p-8 flex items-center gap-3 text-gray-400"><Spinner small /> Loading revenue data...</div>
  );

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Platform Revenue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Platform fees from all landlords</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {genMsg && <span className="text-sm text-green-600 font-medium">{genMsg}</span>}
          <button onClick={downloadPlatformReport} disabled={exportingPdf}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-60 border border-gray-200">
            {exportingPdf ? <Spinner small /> : <FileDown size={14} />}Export Platform Report
          </button>
          <button onClick={generateBills} disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60">
            {generating && <Spinner small />}Generate Platform Bills
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-5">
        <StatCard label="Tenant Rent Collected This Month" value={fmtCurrency(data.monthly_rent_revenue || 0)}
          sub="Total rent paid by tenants across all landlords this month" Icon={TrendingUp} color="green" />
        <StatCard label="Total Revenue Till Date" value={fmtCurrency(data.total_received || 0)}
          sub="All confirmed platform payments" Icon={DollarSign} color="blue" />
        <StatCard label="Total Pending" value={fmtCurrency(data.total_pending || 0)}
          sub="Unpaid + awaiting verification" Icon={Clock} color="yellow" />
      </div>

      {/* Revenue trend chart */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-800 mb-1">Platform Revenue History</h3>
        <p className="text-xs text-gray-400 mb-4">Monthly platform fees collected</p>
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

      {/* Pending verifications */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2 bg-blue-50/50">
          <span className="text-blue-700 font-semibold text-sm">Pending Fee Verifications</span>
          {pendingVerifications.length > 0 && (
            <span className="bg-blue-600 text-white text-xs rounded-full px-2 py-0.5">{pendingVerifications.length}</span>
          )}
        </div>
        {pendingVerifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
            <CheckCircle size={28} className="text-green-400" />
            <p className="text-sm">No pending verifications</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide text-left">
                  {['Landlord', 'Month', 'Amount', 'Submitted On', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingVerifications.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-blue-50/30 cursor-pointer">
                    <td className="px-4 py-3 font-medium text-gray-800">{toTitleCase(p.business_name || p.email)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtMonthYear(p.month_year) || p.month_year}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{fmtCurrency(p.amount)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.paid_at ? fmtDate(p.paid_at) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => verifyPayment(p.id, 'confirm')} disabled={verifying === p.id}
                          className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60">
                          {verifying === p.id ? '...' : 'Confirm'}
                        </button>
                        <button onClick={() => verifyPayment(p.id, 'reject')} disabled={verifying === p.id}
                          className="px-3 py-1 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200 border border-red-200 disabled:opacity-60">
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Landlord breakdown */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-gray-800">Landlord Breakdown</h2>
          {/* Date range filter */}
          <div className="flex items-center gap-2 text-sm">
            <label className="text-gray-500 text-xs">From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <label className="text-gray-500 text-xs">To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {(fromDate || toDate) && (
              <button onClick={() => { setFromDate(''); setToDate(''); }}
                className="text-xs text-blue-600 hover:underline">Clear</button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide text-left">
                {['Landlord', 'Email', 'Status', 'Monthly Fee', 'Total Paid', 'Total Pending', 'Balance', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredBreakdown.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No landlords found.</td></tr>
              )}
              {filteredBreakdown.map((l) => (
                <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-800">{toTitleCase(l.name)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{l.email}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      l.status === 'active' ? 'bg-green-100 text-green-700' :
                      l.status === 'inactive' ? 'bg-gray-100 text-gray-500' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{toTitleCase(l.status)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {l.monthly_fee > 0 ? fmtCurrency(l.monthly_fee) : <span className="text-gray-400 text-xs">Not set</span>}
                  </td>
                  <td className="px-4 py-3 text-green-700 font-medium">{fmtCurrency(l.paid)}</td>
                  <td className="px-4 py-3 text-yellow-600">{fmtCurrency(l.pending_amount)}</td>
                  <td className="px-4 py-3">
                    {Number(l.pending_amount) > 0
                      ? <span className="text-red-600 font-medium">{fmtCurrency(l.pending_amount)} owed</span>
                      : <span className="text-green-600 text-xs font-medium flex items-center gap-1"><CheckCircle size={12} /> Clear</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/admin/landlords/${l.id}`)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-200">
                      <ExternalLink size={11} /> View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
