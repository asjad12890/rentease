import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import { Receipt, UploadCloud, X, Download } from 'lucide-react';
import { fmtDate, fmtMonthYear } from '../../utils/format.jsx';

const STATUS_STYLES = {
  paid:                 'bg-green-600 text-white',
  pending:              'bg-yellow-100 text-yellow-800',
  overdue:              'bg-red-100 text-red-700',
  pending_verification: 'bg-orange-100 text-orange-700',
};

const STATUS_LABELS = {
  paid:                 'Paid',
  pending:              'Pending',
  overdue:              'Overdue',
  pending_verification: 'Awaiting Verification',
};

const ROW_BORDER = {
  paid:    'border-l-4 border-l-green-400',
  pending: 'border-l-4 border-l-yellow-400',
  overdue: 'border-l-4 border-l-red-400',
  pending_verification: 'border-l-4 border-l-orange-400',
};

const BASE = 'http://localhost:8000';

export default function TenantRent() {
  const [payments, setPayments] = useState([]);
  const [payModal, setPayModal] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const fileRef = useRef();

  async function load() {
    const res = await api.get('/my/rent');
    setPayments(res.data);
  }

  useEffect(() => { load(); }, []);

  async function handlePay() {
    setError('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('_ts', Date.now().toString());
      if (receipt) formData.append('receipt', receipt);
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/my/rent/${payModal.id}/pay`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Payment failed');
      }
      setPayModal(null);
      setReceipt(null);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to submit payment');
    } finally {
      setLoading(false);
    }
  }

  const canPay = (status) => status === 'pending' || status === 'overdue';

  async function downloadReceipt(rentId) {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${BASE}/rent/${rentId}/receipt`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt_${rentId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }

  const years = [...new Set(payments.map((p) => p.month_year?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const filtered = yearFilter === 'all' ? payments : payments.filter((p) => p.month_year?.startsWith(yearFilter));

  const currentYear = new Date().getFullYear().toString();
  const yearPayments = payments.filter((p) => p.month_year?.startsWith(currentYear));
  const totalPaidYear = yearPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0);
  const onTimeCount = yearPayments.filter((p) => p.status === 'paid').length;
  const overdueAmount = payments.filter((p) => p.status === 'overdue').reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <div className="p-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Rent History</h1>
        {years.length > 1 && (
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All Years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm border-l-4 border-l-green-500">
          <p className="text-xs text-gray-400 font-medium">Total Paid — {currentYear}</p>
          <p className="text-xl font-bold text-green-700 mt-1">₨ {totalPaidYear.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm border-l-4 border-l-blue-400">
          <p className="text-xs text-gray-400 font-medium">On-time Payments</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{onTimeCount}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm border-l-4 border-l-red-400">
          <p className="text-xs text-gray-400 font-medium">Overdue Amount</p>
          <p className="text-xl font-bold text-red-600 mt-1">₨ {overdueAmount.toLocaleString()}</p>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm">
          <Receipt size={44} className="mx-auto mb-3 text-gray-200" />
          <p className="text-gray-500 font-medium">No rent history yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide text-left">
                  {['Month', 'Amount', 'Due Date', 'Status', 'Paid On', 'Receipt', 'Action'].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className={`border-t border-gray-100 hover:bg-gray-50 ${ROW_BORDER[p.status] || ''} ${p.status === 'pending_verification' ? 'bg-orange-50/30' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{fmtMonthYear(p.month_year)}</td>
                    <td className="px-4 py-3 font-medium">₨ {p.amount?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500">{p.due_date ? fmtDate(p.due_date) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.paid_at ? fmtDate(p.paid_at) : '—'}</td>
                    <td className="px-4 py-3">
                      {p.status === 'paid' ? (
                        <button
                          onClick={() => downloadReceipt(p.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition"
                        >
                          <Download size={11} /> Download Receipt
                        </button>
                      ) : p.receipt_image ? (
                        <a href={`${BASE}/uploads/${p.receipt_image}`} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition">
                          <Receipt size={11} /> View Receipt
                        </a>
                      ) : <span className="text-xs text-gray-300 italic">Not uploaded</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {p.status === 'paid' && (
                          <span className="text-xs text-green-600 font-medium">Complete</span>
                        )}
                        {p.status === 'pending_verification' && (
                          <span className="text-xs text-orange-600 font-medium">Under review</span>
                        )}
                        {p.notes?.startsWith('Rejected:') && (
                          <span className="text-xs text-red-500 font-medium" title={p.notes}>Rejected</span>
                        )}
                        {canPay(p.status) && (
                          <button
                            onClick={() => { setPayModal(p); setReceipt(null); setError(''); }}
                            className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                              p.status === 'overdue'
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            Pay Now
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPayModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-gray-800">Submit Payment</h3>
              <button onClick={() => setPayModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="text-xs text-gray-400 mb-4">{fmtMonthYear(payModal.month_year)}</p>
            {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-4">
              <p className="text-xs text-gray-500">Amount Due</p>
              <p className="text-2xl font-bold text-blue-700">₨ {payModal.amount?.toLocaleString()}</p>
            </div>

            {payModal.notes?.startsWith('Rejected:') && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs font-medium text-red-700 mb-1">Previous submission was rejected:</p>
                <p className="text-sm text-red-600">{payModal.notes.replace('Rejected: ', '')}</p>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload Receipt <span className="text-gray-400 font-normal">(optional but recommended)</span>
              </label>
              {receipt ? (
                <div className="flex items-center justify-between p-3 border border-gray-200 rounded-xl bg-gray-50">
                  <div className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
                    <Receipt size={14} className="text-blue-500 shrink-0" />
                    <span className="truncate">{receipt.name}</span>
                  </div>
                  <button onClick={() => { setReceipt(null); if (fileRef.current) fileRef.current.value = ''; }}
                    className="ml-2 text-gray-400 hover:text-red-500 shrink-0"><X size={14} /></button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-xl p-5 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition">
                  <UploadCloud size={28} className="text-gray-300 mb-2" />
                  <span className="text-sm text-gray-500">Click to upload</span>
                  <span className="text-xs text-gray-400 mt-1">JPG, PNG up to 5MB</span>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => setReceipt(e.target.files[0])} />
                </label>
              )}
            </div>

            <div className="p-3 bg-yellow-50 rounded-xl border border-yellow-100 mb-4">
              <p className="text-xs text-yellow-700">Your payment will be sent to your landlord for verification. Status will show as "Awaiting Verification" until confirmed.</p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setPayModal(null)} className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handlePay} disabled={loading}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-60">
                {loading && <Spinner small />}
                Submit Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
