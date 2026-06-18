import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import Modal from '../../components/Modal';
import { fmtDate, fmtMonthYear } from '../../utils/format.jsx';
import { getPhotoUrl } from '../../api/config';

const STATUS_STYLES = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  pending_verification: 'bg-orange-100 text-orange-700',
};

const STATUS_LABELS = {
  paid: 'Paid',
  pending: 'Pending',
  overdue: 'Overdue',
  pending_verification: 'Pending Verification',
};

export default function Rent() {
  const ctx = useOutletContext();
  const now = new Date();
  const [monthYear, setMonthYear] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );
  const [payments, setPayments] = useState([]);
  const [loadingId, setLoadingId] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  // Generate rent modal state
  const [showGenModal, setShowGenModal] = useState(false);
  const [genMonth, setGenMonth] = useState(monthYear);
  const [tenantList, setTenantList] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState('');

  async function load() {
    const res = await api.get('/rent', { params: { month_year: monthYear } });
    setPayments(res.data);
  }

  useEffect(() => { load(); }, [monthYear]);

  async function openGenModal() {
    setGenMonth(monthYear);
    setGenResult('');
    setShowGenModal(true);
    setLoadingTenants(true);
    try {
      const res = await api.get('/rent/tenants', { params: { month_year: monthYear } });
      setTenantList(res.data);
      // Pre-select tenants without existing rent
      setSelectedIds(new Set(res.data.filter((t) => !t.has_rent_generated).map((t) => t.id)));
    } catch { setTenantList([]); }
    finally { setLoadingTenants(false); }
  }

  async function refreshGenModal(month) {
    setLoadingTenants(true);
    try {
      const res = await api.get('/rent/tenants', { params: { month_year: month } });
      setTenantList(res.data);
      setSelectedIds(new Set(res.data.filter((t) => !t.has_rent_generated).map((t) => t.id)));
    } catch { setTenantList([]); }
    finally { setLoadingTenants(false); }
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenResult('');
    try {
      const ids = Array.from(selectedIds);
      const res = await api.post('/rent/generate', {
        month_year: genMonth,
        tenant_ids: ids.length > 0 ? ids : undefined,
      });
      setGenResult(`✓ ${res.data.message}`);
      await load();
      await refreshGenModal(genMonth);
    } catch (err) {
      setGenResult(err.response?.data?.detail || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  }

  function toggleTenant(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const selectable = tenantList.filter((t) => !t.has_rent_generated).map((t) => t.id);
    if (selectedIds.size === selectable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable));
    }
  }

  async function markStatus(id, status) {
    setLoadingId(id);
    try {
      await api.put(`/rent/${id}/status`, { status });
      await load();
    } finally {
      setLoadingId(null);
    }
  }

  async function verifyPayment(id) {
    setLoadingId(id);
    try {
      await api.put(`/rent/${id}/verify`);
      await load();
      ctx?.reloadNotifications?.();
    } finally {
      setLoadingId(null);
    }
  }

  async function rejectPayment() {
    if (!rejectNote.trim()) return;
    setLoadingId(rejectModal.id);
    try {
      await api.put(`/rent/${rejectModal.id}/reject-payment`, { notes: rejectNote });
      setRejectModal(null);
      setRejectNote('');
      await load();
    } finally {
      setLoadingId(null);
    }
  }

  const totalCollected = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const totalPending = payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
  const totalOverdue = payments.filter((p) => p.status === 'overdue').reduce((s, p) => s + p.amount, 0);
  const pendingVerification = payments.filter((p) => p.status === 'pending_verification');
  const selectableCount = tenantList.filter((t) => !t.has_rent_generated).length;

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Rent Payments</h1>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="month"
            value={monthYear}
            onChange={(e) => setMonthYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={openGenModal}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            ⚡ Generate Rent
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-green-50 rounded-xl p-4 border border-green-100">
          <p className="text-xs text-green-600 font-medium">Collected</p>
          <p className="text-xl font-bold text-green-700 mt-1">₨ {totalCollected.toLocaleString()}</p>
        </div>
        <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100">
          <p className="text-xs text-yellow-600 font-medium">Pending</p>
          <p className="text-xl font-bold text-yellow-700 mt-1">₨ {totalPending.toLocaleString()}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4 border border-red-100">
          <p className="text-xs text-red-600 font-medium">Overdue</p>
          <p className="text-xl font-bold text-red-700 mt-1">₨ {totalOverdue.toLocaleString()}</p>
        </div>
        <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
          <p className="text-xs text-orange-600 font-medium">Awaiting Verification</p>
          <p className="text-xl font-bold text-orange-700 mt-1">{pendingVerification.length}</p>
        </div>
      </div>

      {pendingVerification.length > 0 && (
        <div className="mb-5 p-4 bg-orange-50 border border-orange-200 rounded-xl flex items-center gap-3">
          <span className="text-xl">⏳</span>
          <p className="text-sm text-orange-800 font-medium">
            {pendingVerification.length} payment{pendingVerification.length > 1 ? 's' : ''} submitted by tenants require{pendingVerification.length === 1 ? 's' : ''} your verification.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-left">
                {['Tenant', 'Room', 'Amount', 'Due Date', 'Status', 'Receipt', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-gray-400">
                    <div className="text-5xl mb-3">💰</div>
                    <p className="text-base font-medium text-gray-500">No rent entries for this month</p>
                    <p className="text-sm mt-1 mb-4">Click "Generate Rent" to create entries for all tenants</p>
                    <button
                      onClick={openGenModal}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                    >
                      Generate Rent
                    </button>
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-gray-100 hover:bg-gray-50 ${p.status === 'pending_verification' ? 'bg-orange-50/40' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{p.tenant_name}</td>
                  <td className="px-4 py-3 text-gray-600">Room {p.room_number}</td>
                  <td className="px-4 py-3 font-medium">₨ {p.amount?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(p.due_date)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLES[p.status]}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.receipt_image ? (
                      <a href={getPhotoUrl(p.receipt_image)} target="_blank" rel="noreferrer">
                        <img
                          src={getPhotoUrl(p.receipt_image)}
                          alt="receipt"
                          className="w-10 h-10 object-cover rounded-lg border border-gray-200 hover:opacity-80 transition"
                          onError={(e) => { e.target.style.display='none'; }}
                        />
                      </a>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {p.status === 'pending_verification' && (
                        <>
                          <button onClick={() => verifyPayment(p.id)} disabled={loadingId === p.id}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1 disabled:opacity-60">
                            {loadingId === p.id && <Spinner small />}Confirm
                          </button>
                          <button onClick={() => { setRejectModal(p); setRejectNote(''); }} disabled={loadingId === p.id}
                            className="px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100">
                            Reject
                          </button>
                        </>
                      )}
                      {(p.status === 'pending' || p.status === 'overdue') && (
                        <button onClick={() => markStatus(p.id, 'paid')} disabled={loadingId === p.id}
                          className="px-2 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100 flex items-center gap-1">
                          {loadingId === p.id && <Spinner small />}Mark Paid
                        </button>
                      )}
                      {p.status === 'paid' && (
                        <button onClick={() => markStatus(p.id, 'pending')} disabled={loadingId === p.id}
                          className="px-2 py-1 text-xs bg-yellow-50 text-yellow-700 rounded hover:bg-yellow-100">
                          Mark Pending
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

      {/* Generate Rent Modal */}
      {showGenModal && (
        <Modal title="Generate Rent" onClose={() => setShowGenModal(false)}>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Month:</label>
              <input
                type="month"
                value={genMonth}
                onChange={(e) => { setGenMonth(e.target.value); refreshGenModal(e.target.value); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>

            {loadingTenants ? (
              <div className="flex items-center gap-2 text-gray-400 py-4"><Spinner small /> Loading tenants...</div>
            ) : tenantList.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No tenants with rooms assigned.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === selectableCount && selectableCount > 0}
                      onChange={toggleAll}
                      className="rounded"
                    />
                    Select All ({selectableCount} available)
                  </label>
                  <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                  {tenantList.map((t) => (
                    <label
                      key={t.id}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition ${
                        t.has_rent_generated ? 'opacity-50 bg-gray-50 cursor-not-allowed' : 'hover:bg-blue-50/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => !t.has_rent_generated && toggleTenant(t.id)}
                          disabled={t.has_rent_generated}
                          className="rounded"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{t.name}</p>
                          <p className="text-xs text-gray-400">
                            Room {t.room_number} · {t.beds_taken} bed{t.beds_taken > 1 ? 's' : ''} · {t.property_name}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {t.has_rent_generated ? (
                          <span className="text-xs text-gray-400 italic">Already generated</span>
                        ) : (
                          <span className="text-sm font-semibold text-gray-700">₨ {Number(t.expected_amount).toLocaleString()}</span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {genResult && (
              <p className={`text-sm font-medium ${genResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                {genResult}
              </p>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowGenModal(false)} className="px-4 py-2 text-sm text-gray-600">Close</button>
              <button
                onClick={handleGenerate}
                disabled={generating || selectedIds.size === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-2 disabled:opacity-60"
              >
                {generating && <Spinner small />}
                Generate for Selected ({selectedIds.size})
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject payment modal */}
      {rejectModal && (
        <Modal title="Reject Payment" onClose={() => setRejectModal(null)}>
          <div className="space-y-4">
            <div className="p-3 bg-red-50 rounded-lg">
              <p className="text-sm font-medium text-red-800">Rejecting payment from {rejectModal.tenant_name} for {fmtMonthYear(rejectModal.month_year)}</p>
              <p className="text-xs text-red-600 mt-0.5">Payment will go back to "Pending" status.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason for rejection *</label>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                rows={3}
                placeholder="e.g. Receipt image is unclear..."
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setRejectModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={rejectPayment}
                disabled={loadingId === rejectModal?.id || !rejectNote.trim()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 flex items-center gap-2 disabled:opacity-60"
              >
                {loadingId === rejectModal?.id && <Spinner small />}Reject Payment
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
