import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ChevronRight, Users, X,
} from 'lucide-react';
import Modal from '../../components/Modal';
import Spinner from '../../components/Spinner';
import { toTitleCase, fmtCurrency } from '../../utils/format.jsx';

const BASE = 'http://localhost:8000';
const token = () => localStorage.getItem('token');
const authHeaders = () => ({
  'Authorization': `Bearer ${token()}`,
  'Content-Type': 'application/json',
});

const STATUS_COLORS = {
  pending:  'bg-yellow-100 text-yellow-800',
  active:   'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
};

function ConfirmModal({ title, message, confirmLabel, confirmClass, onConfirm, onClose, loading }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} disabled={loading}
            className={`px-4 py-2 text-sm text-white rounded-lg flex items-center gap-2 disabled:opacity-60 ${confirmClass}`}>
            {loading && <Spinner small />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminLandlords() {
  const navigate = useNavigate();
  const [landlords, setLandlords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [feeModal, setFeeModal] = useState(null);
  const [feeInput, setFeeInput] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeact, setConfirmDeact] = useState(null);

  async function load() {
    try {
      const res = await fetch(`${BASE}/admin/landlords`, { headers: authHeaders() });
      if (res.status === 401) { setError('401 - Not authenticated'); return; }
      if (res.status === 403) { setError('403 - Not authorized'); return; }
      if (!res.ok) { setError(`Error: ${res.status} ${res.statusText}`); return; }
      setLandlords(await res.json());
      setError('');
    } catch (e) {
      setError(`Network error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitSetFee() {
    setFeeLoading(true);
    try {
      const res = await fetch(`${BASE}/admin/landlords/${feeModal.id}/set-fee`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ monthly_fee: parseFloat(feeInput) || 0 }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || `Error: ${res.status}`); return; }
      setFeeModal(null);
      await load();
    } finally { setFeeLoading(false); }
  }

  async function activate(l, e) {
    e?.stopPropagation();
    setSavingId(`act-${l.id}`);
    try {
      await fetch(`${BASE}/admin/landlords/${l.id}/activate`, { method: 'PUT', headers: authHeaders() });
      await load();
    } finally { setSavingId(null); }
  }

  async function doDeactivate() {
    const l = confirmDeact;
    setConfirmDeact(null);
    setSavingId(`deact-${l.id}`);
    try {
      await fetch(`${BASE}/admin/landlords/${l.id}/deactivate`, { method: 'PUT', headers: authHeaders() });
      await load();
    } finally { setSavingId(null); }
  }

  async function doDelete() {
    const l = confirmDelete;
    setConfirmDelete(null);
    setSavingId(`del-${l.id}`);
    try {
      const res = await fetch(`${BASE}/admin/landlords/${l.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || `Delete failed: ${res.status}`); return; }
      await load();
    } finally { setSavingId(null); }
  }

  const sorted = [...landlords].sort((a, b) => (a.business_name || a.name || '').localeCompare(b.business_name || b.name || ''));

  const searched = sorted.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (l.business_name || '').toLowerCase().includes(q) ||
      (l.name || '').toLowerCase().includes(q) ||
      (l.email || '').toLowerCase().includes(q);
  });

  const activeLandlords = searched.filter((l) => l.status === 'active');
  const inactiveLandlords = searched.filter((l) => l.status === 'inactive' || l.status === 'rejected');
  const tabLandlords = activeTab === 'active' ? activeLandlords : inactiveLandlords;

  if (loading) return (
    <div className="p-8 flex items-center gap-3 text-gray-400"><Spinner small /> Loading landlords...</div>
  );

  if (error) return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Landlords</h1>
      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
        <p className="text-red-700 font-medium mb-1">Failed to load</p>
        <p className="text-red-600 text-sm font-mono mb-4">{error}</p>
        <button onClick={load} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Retry</button>
      </div>
    </div>
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Landlords</h1>
          <p className="text-sm text-gray-400 mt-0.5">Click a landlord name to view full details</p>
        </div>
        <span className="text-sm text-gray-400">{landlords.length} total</span>
      </div>

      {/* Search + Tabs */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" placeholder="Search by name or email…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex rounded-lg bg-gray-100 p-1">
          {[
            { key: 'active', label: `Active (${sorted.filter((l) => l.status === 'active').length})` },
            { key: 'inactive', label: `Inactive (${sorted.filter((l) => l.status === 'inactive' || l.status === 'rejected').length})` },
          ].map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-5 py-1.5 rounded-md text-sm font-medium transition ${activeTab === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left text-xs uppercase tracking-wide">
                {['Business', 'Email', 'Properties', 'Tenants', 'Monthly Fee', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tabLandlords.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Users size={32} className="opacity-30" />
                      <p className="text-sm">{search ? 'No landlords match your search.' : 'No landlords in this category.'}</p>
                    </div>
                  </td>
                </tr>
              )}
              {tabLandlords.map((l) => (
                <tr key={l.id} onClick={() => navigate(`/admin/landlords/${l.id}`)}
                  className={`group border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition ${l.status === 'pending' ? 'bg-yellow-50/20' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-blue-600 underline underline-offset-2 group-hover:text-blue-800">
                        {toTitleCase(l.business_name || l.name)}
                      </span>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-400 transition" />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{l.email}</td>
                  <td className="px-4 py-3 text-gray-700">{l.property_count}</td>
                  <td className="px-4 py-3 text-gray-700">{l.tenant_count}</td>
                  <td className="px-4 py-3">
                    {l.monthly_fee > 0
                      ? <span className="text-green-700 font-semibold">{fmtCurrency(l.monthly_fee)}</span>
                      : <span className="text-gray-400 text-sm">Not set</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[l.status] || 'bg-gray-100 text-gray-600'}`}>
                      {toTitleCase(l.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5 flex-wrap">
                      {(l.status === 'inactive' || l.status === 'rejected') && (
                        <button onClick={(e) => { e.stopPropagation(); activate(l, e); }} disabled={savingId === `act-${l.id}`}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 flex items-center gap-1 disabled:opacity-60">
                          {savingId === `act-${l.id}` && <Spinner small />}Activate
                        </button>
                      )}
                      {l.status === 'active' && (
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeact(l); }} disabled={savingId === `deact-${l.id}`}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 flex items-center gap-1 disabled:opacity-60">
                          {savingId === `deact-${l.id}` && <Spinner small />}Deactivate
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setFeeModal(l); setFeeInput(l.monthly_fee > 0 ? String(l.monthly_fee) : ''); }}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">
                        Set Fee
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(l); }} disabled={savingId === `del-${l.id}`}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 flex items-center gap-1 disabled:opacity-60">
                        {savingId === `del-${l.id}` && <Spinner small />}Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Set fee modal */}
      {feeModal && (
        <Modal title={`Set Monthly Fee — ${toTitleCase(feeModal.business_name || feeModal.name)}`} onClose={() => setFeeModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Update the monthly platform fee for this landlord.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Fee (PKR)</label>
              <input type="number" min="0" value={feeInput} onChange={(e) => setFeeInput(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 2000" />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setFeeModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={submitSetFee} disabled={feeLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {feeLoading && <Spinner small />}Save Fee
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmModal
          title="Delete Landlord"
          message={`Are you sure you want to delete "${toTitleCase(confirmDelete.business_name || confirmDelete.name)}"? All their properties and tenants will also be deleted. This cannot be undone.`}
          confirmLabel="Delete"
          confirmClass="bg-red-600 hover:bg-red-700"
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(null)}
          loading={savingId === `del-${confirmDelete?.id}`}
        />
      )}

      {/* Deactivate confirmation */}
      {confirmDeact && (
        <ConfirmModal
          title="Deactivate Landlord"
          message={`This will also deactivate all tenants of "${toTitleCase(confirmDeact.business_name || confirmDeact.name)}". Continue?`}
          confirmLabel="Deactivate"
          confirmClass="bg-orange-500 hover:bg-orange-600"
          onConfirm={doDeactivate}
          onClose={() => setConfirmDeact(null)}
          loading={savingId === `deact-${confirmDeact?.id}`}
        />
      )}
    </div>
  );
}
