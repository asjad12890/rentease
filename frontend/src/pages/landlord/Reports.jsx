import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import { ExternalLink, Receipt } from 'lucide-react';
import { fmtDate, fmtMonthYear } from '../../utils/format.jsx';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatMonth(my) {
  if (!my) return my;
  const [y, m] = my.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

export default function Reports() {
  const [summary, setSummary] = useState(null);
  const [occupancy, setOccupancy] = useState([]);
  const [profit, setProfit] = useState(null);
  const [feeData, setFeeData] = useState(null);
  const [paying, setPaying] = useState(null);

  async function loadData() {
    const [r, o, p, f] = await Promise.all([
      api.get('/reports/revenue'),
      api.get('/reports/occupancy'),
      api.get('/reports/profit').catch(() => null),
      api.get('/landlord/platform-fee').catch(() => null),
    ]);
    setSummary(r.data);
    setOccupancy(o.data);
    setProfit(p?.data || null);
    setFeeData(f?.data || null);
  }

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 30_000);
    return () => clearInterval(iv);
  }, []);

  async function markFeePaid(pid) {
    setPaying(pid);
    try {
      await api.put(`/landlord/platform-fee/${pid}/pay`);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed');
    } finally { setPaying(null); }
  }

  if (!summary) return <div className="p-8 text-gray-400">Loading...</div>;

  // Sort profit chart data chronologically
  const profitChartData = [...(profit?.monthly_breakdown || [])]
    .sort((a, b) => a.month_year.localeCompare(b.month_year))
    .map((d) => ({ ...d, month: formatMonth(d.month_year) }));

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Reports & Financials</h1>

      {/* 1. All-time profit summary cards */}
      {profit && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Total Revenue Collected | Platform Fees Paid | Net Profit</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 rounded-xl p-4 border border-green-100">
              <p className="text-xs text-green-600 font-medium">Total Revenue Collected</p>
              <p className="text-2xl font-bold text-green-700 mt-1">₨ {profit.total_revenue.toLocaleString()}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 border border-red-100">
              <p className="text-xs text-red-600 font-medium">Platform Fees Paid</p>
              <p className="text-2xl font-bold text-red-700 mt-1">₨ {profit.total_platform_fees.toLocaleString()}</p>
            </div>
            <div className={`rounded-xl p-4 border ${profit.net_profit >= 0 ? 'bg-blue-50 border-blue-100' : 'bg-orange-50 border-orange-100'}`}>
              <p className={`text-xs font-medium ${profit.net_profit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>Net Profit</p>
              <p className={`text-2xl font-bold mt-1 ${profit.net_profit >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
                ₨ {profit.net_profit.toLocaleString()}
              </p>
              {profit.net_profit < 0 && <p className="text-xs text-orange-500 mt-1">⚠ Fees exceed revenue</p>}
            </div>
          </div>
        </div>
      )}

      {/* 2. Platform Fee section */}
      {feeData && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800">Platform Fee</h2>
              <p className="text-xs text-gray-400 mt-0.5">Monthly fee charged by the platform</p>
            </div>
            {(feeData.monthly_fee || 0) > 0 && (
              <div className="text-right">
                <p className="text-xs text-gray-400">Monthly Fee</p>
                <p className="text-xl font-bold text-blue-700">₨ {feeData.monthly_fee.toLocaleString()}</p>
              </div>
            )}
          </div>
          {(feeData.monthly_fee || 0) <= 0 ? (
            <p className="px-6 py-6 text-gray-400 text-sm text-center">No platform fee set. Contact admin.</p>
          ) : (
            <div className="p-6">
              <div className={`rounded-xl p-4 mb-4 border ${
                feeData.current_month_status === 'paid' ? 'bg-green-50 border-green-100' :
                feeData.current_month_status === 'pending_verification' ? 'bg-blue-50 border-blue-100' :
                feeData.current_month_status === 'pending' ? 'bg-yellow-50 border-yellow-100' :
                'bg-gray-50 border-gray-100'
              }`}>
                <p className="text-xs text-gray-500 font-medium">{fmtMonthYear(feeData.current_month)} Status</p>
                <p className={`text-lg font-bold mt-1 ${
                  feeData.current_month_status === 'paid' ? 'text-green-700' :
                  feeData.current_month_status === 'pending_verification' ? 'text-blue-700' :
                  feeData.current_month_status === 'pending' ? 'text-yellow-700' : 'text-gray-500'
                }`}>
                  {feeData.current_month_status === 'paid' ? 'Paid' :
                   feeData.current_month_status === 'pending_verification' ? 'Awaiting Admin Verification' :
                   feeData.current_month_status === 'pending' ? 'Bill Pending' : 'No bill generated'}
                </p>
                {feeData.current_month_status === 'pending' && feeData.current_month_payment_id && (
                  <button onClick={() => markFeePaid(feeData.current_month_payment_id)} disabled={paying === feeData.current_month_payment_id}
                    className="mt-3 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-60">
                    {paying === feeData.current_month_payment_id && <Spinner small />} Pay Now
                  </button>
                )}
              </div>
              {(feeData.history || []).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase text-left bg-gray-50">
                        {['Month', 'Amount', 'Due Date', 'Status', 'Paid On', 'Action'].map((h) => (
                          <th key={h} className="px-4 py-2 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {feeData.history.map((p) => (
                        <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium">{fmtMonthYear(p.month_year)}</td>
                          <td className="px-4 py-2">₨ {Number(p.amount).toLocaleString()}</td>
                          <td className="px-4 py-2 text-gray-500">{p.due_date ? fmtDate(p.due_date) : '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              p.status === 'paid' ? 'bg-green-100 text-green-700' :
                              p.status === 'pending_verification' ? 'bg-blue-100 text-blue-700' :
                              'bg-yellow-100 text-yellow-700'}`}>
                              {p.status === 'paid' ? 'Paid' : p.status === 'pending_verification' ? 'Awaiting Verification' : 'Pending'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-500">{p.paid_at ? fmtDate(p.paid_at) : '—'}</td>
                          <td className="px-4 py-2">
                            <div className="flex gap-2 items-center">
                              {p.status === 'pending' && (
                                <button onClick={() => markFeePaid(p.id)} disabled={paying === p.id}
                                  className="px-2.5 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-1">
                                  {paying === p.id ? '...' : 'Pay Now'}
                                </button>
                              )}
                              {p.status === 'pending_verification' && (
                                <span className="text-xs text-blue-500 font-medium">Awaiting</span>
                              )}
                              {p.receipt_image && (
                                <a href={`http://localhost:8000/uploads/${p.receipt_image}`} target="_blank" rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                                  <Receipt size={12} /> Receipt
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. Monthly Revenue — current month */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Current Month — Rent</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-xl p-4 border border-green-100">
            <p className="text-xs text-green-600 font-medium">Collected This Month</p>
            <p className="text-2xl font-bold text-green-700 mt-1">₨ {(summary.collected_this_month || 0).toLocaleString()}</p>
            <p className="text-[10px] text-green-500 mt-1">confirmed payments only</p>
          </div>
          <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100">
            <p className="text-xs text-yellow-600 font-medium">Pending This Month</p>
            <p className="text-2xl font-bold text-yellow-700 mt-1">₨ {(summary.pending_this_month || 0).toLocaleString()}</p>
          </div>
          <div className="bg-red-50 rounded-xl p-4 border border-red-100">
            <p className="text-xs text-red-600 font-medium">Overdue Amount</p>
            <p className="text-2xl font-bold text-red-700 mt-1">₨ {(summary.overdue_amount || 0).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* 4. Occupancy Rate chart */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-base font-semibold text-gray-800 mb-1">Occupancy Rate by Property</h2>
        <p className="text-xs text-gray-400 mb-4">Percentage of beds occupied per property</p>
        {occupancy.length === 0 ? (
          <p className="text-gray-400 text-center py-6">No occupancy data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={occupancy} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v, name, props) => [`${v}% (${props.payload.occupied_beds}/${props.payload.total_beds} beds)`, 'Occupancy']} />
              <Bar dataKey="occupancy_rate" name="Occupancy %" radius={[3,3,0,0]}>
                {occupancy.map((entry, i) => (
                  <Cell key={i} fill={entry.occupancy_rate === 100 ? '#22c55e' : entry.occupancy_rate === 0 ? '#ef4444' : '#3b82f6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 5. Monthly Rent Revenue bar chart — last 12 months */}
      {profit && profitChartData.length === 0 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 text-center text-gray-400 py-10">
          <p className="text-sm">No rent payment data yet. Revenue chart will appear once rent is collected.</p>
        </div>
      )}
      {profit && profitChartData.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-800 mb-1">Monthly Rent Revenue — Last 12 Months</h3>
          <p className="text-xs text-gray-400 mb-4">Revenue vs Platform Fee vs Net Profit (PKR)</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={profitChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₨${Math.abs(v/1000).toFixed(0)}k`} allowDataOverflow />
              <Tooltip formatter={(v) => `₨ ${v?.toLocaleString()}`} />
              <Legend />
              <Bar dataKey="rent_collected" name="Rent (PKR)" fill="#3b82f6" radius={[3,3,0,0]} />
              <Bar dataKey="platform_fee" name="Platform Fee (PKR)" fill="#f97316" radius={[3,3,0,0]} />
              <Bar dataKey="net_profit" name="Net Profit (PKR)" radius={[3,3,0,0]}>
                {profitChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.net_profit >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
