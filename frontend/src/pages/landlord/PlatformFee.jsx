import { useEffect, useState } from 'react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import { fmtDate, fmtMonthYear } from '../../utils/format.jsx';

export default function PlatformFee() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [paying, setPaying] = useState(null);

  async function load() {
    setLoadError('');
    try {
      const res = await api.get('/landlord/platform-fee');
      console.log('[PlatformFee] API response:', res.data);
      setData(res.data);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Failed to load platform fee data';
      console.error('[PlatformFee] error:', msg, err);
      setLoadError(msg);
    }
  }

  useEffect(() => { load(); }, []);

  async function markPaid(pid) {
    setPaying(pid);
    try {
      await api.put(`/landlord/platform-fee/${pid}/pay`);
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to mark as paid');
    } finally {
      setPaying(null);
    }
  }

  if (loadError) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">Platform Fee</h1>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600 font-medium mb-3">{loadError}</p>
          <button
            onClick={load}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-400">
        <Spinner small /> Loading platform fee...
      </div>
    );
  }

  // New field names from backend: current_month_status, current_month_payment_id
  const { monthly_fee, current_month, current_month_status, current_month_payment_id, history } = data;
  const isPaid = current_month_status === 'paid';
  const isPendingVerification = current_month_status === 'pending_verification';
  const isPending = current_month_status === 'pending';

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Platform Fee</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
          <p className="text-xs text-blue-600 font-medium uppercase tracking-wide">Monthly Platform Fee</p>
          {monthly_fee > 0 ? (
            <p className="text-3xl font-bold text-blue-700 mt-1">₨ {monthly_fee.toLocaleString()}</p>
          ) : (
            <p className="text-base font-medium text-gray-400 mt-2">No platform fee set. Contact admin.</p>
          )}
          <p className="text-xs text-blue-500 mt-1">Amount charged each month by the platform</p>
        </div>

        <div className={`border rounded-xl p-5 ${
          isPaid ? 'bg-green-50 border-green-100'
          : isPendingVerification ? 'bg-blue-50 border-blue-100'
          : isPending ? 'bg-yellow-50 border-yellow-100'
          : 'bg-gray-50 border-gray-100'
        }`}>
          <p className={`text-xs font-medium uppercase tracking-wide ${
            isPaid ? 'text-green-600'
            : isPendingVerification ? 'text-blue-600'
            : isPending ? 'text-yellow-600' : 'text-gray-500'
          }`}>
            {current_month} Status
          </p>
          <p className={`text-xl font-bold mt-1 ${
            isPaid ? 'text-green-700'
            : isPendingVerification ? 'text-blue-700'
            : isPending ? 'text-yellow-700' : 'text-gray-600'
          }`}>
            {isPaid ? '✓ Paid'
             : isPendingVerification ? '⏳ Awaiting Admin Verification'
             : isPending ? 'Bill Pending' : 'No bill generated'}
          </p>
          {isPendingVerification && (
            <p className="text-xs text-blue-500 mt-2">Your payment has been submitted. Admin will verify shortly.</p>
          )}
          {isPending && current_month_payment_id && (
            <button
              onClick={() => markPaid(current_month_payment_id)}
              disabled={paying === current_month_payment_id}
              className="mt-3 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-60"
            >
              {paying === current_month_payment_id && <Spinner small />}
              Mark as Paid
            </button>
          )}
        </div>
      </div>

      {/* Payment history */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Payment History</h2>
        </div>
        {history.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400">
            No payment records yet. Bills are generated by the admin each month.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  {['Month', 'Amount', 'Due Date', 'Status', 'Paid On', 'Action'].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{fmtMonthYear(p.month_year)}</td>
                    <td className="px-4 py-3">₨ {p.amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-500">{p.due_date || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.status === 'paid' ? 'bg-green-100 text-green-700'
                        : p.status === 'pending_verification' ? 'bg-blue-100 text-blue-700'
                        : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {p.status === 'paid' ? 'Paid' : p.status === 'pending_verification' ? 'Submitted' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{fmtDate(p.paid_at)}</td>
                    <td className="px-4 py-3">
                      {p.status === 'pending' && (
                        <button
                          onClick={() => markPaid(p.id)}
                          disabled={paying === p.id}
                          className="px-2.5 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1 disabled:opacity-60"
                        >
                          {paying === p.id && <Spinner small />}
                          Mark Paid
                        </button>
                      )}
                      {p.status === 'pending_verification' && (
                        <span className="text-xs text-blue-500">Awaiting verification</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
