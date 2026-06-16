import { useEffect, useState } from 'react';
import api from '../../api/client';
import Modal from '../../components/Modal';
import Spinner from '../../components/Spinner';
import { Search, Users, Download } from 'lucide-react';

const PHONE_RE = /^03\d{2}-\d{7}$/;
const CNIC_RE = /^\d{5}-\d{7}-\d$/;
import { fmtDate, fmtMonthYear, toTitleCase } from '../../utils/format.jsx';

function ConfirmModal({ title, message, confirmLabel = 'Confirm', confirmClass = 'bg-red-600 hover:bg-red-700', onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-800 text-base mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className={`flex-1 py-2 text-sm text-white rounded-lg ${confirmClass}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

const RENT_STYLES = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  pending_verification: 'bg-orange-100 text-orange-700',
};
const RENT_LABELS = {
  paid: 'Paid', pending: 'Pending', overdue: 'Overdue',
  pending_verification: 'Verifying', none: 'Not Generated',
};


export default function Tenants() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const [tenants, setTenants] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [rentMap, setRentMap] = useState({}); // tid → rent payment
  const [search, setSearch] = useState('');
  const [propFilter, setPropFilter] = useState('');
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm }
  const [showAdd, setShowAdd] = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [credModal, setCredModal] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [bedsTaken, setBedsTaken] = useState(1);
  const [rentDueDay, setRentDueDay] = useState(1);
  const [form, setForm] = useState({ name: '', email: '', phone: '', cnic: '', emergency_contact: '', move_in_date: '' });
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState('');

  // Edit tenant modal
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', cnic: '', emergency_contact: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Tenant detail modal
  const [detailModal, setDetailModal] = useState(null);
  const [detailRents, setDetailRents] = useState([]);
  const [detailRentsLoading, setDetailRentsLoading] = useState(false);

  async function openDetailModal(t) {
    setDetailModal(t);
    setDetailRents([]);
    setDetailRentsLoading(true);
    try {
      const res = await api.get('/rent', { params: { tenant_id: t.id } });
      setDetailRents(res.data);
    } catch { setDetailRents([]); }
    finally { setDetailRentsLoading(false); }
  }

  // Rent action modal (per tenant)
  const [rentModal, setRentModal] = useState(null); // { tenant, payment }
  const [rentActionId, setRentActionId] = useState(null);

  // Generate rent modal
  const [showGenModal, setShowGenModal] = useState(false);
  const [genMonth, setGenMonth] = useState(currentMonth);
  const [tenantList, setTenantList] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState('');

  async function load() {
    const [tRes, rRes, rentRes] = await Promise.all([
      api.get('/tenants'),
      api.get('/rooms', { params: { available_only: true } }),
      api.get('/rent', { params: { month_year: currentMonth } }),
    ]);
    const sortedTenants = [...tRes.data].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    setTenants(sortedTenants);
    const sortedRooms = [...rRes.data].sort((a, b) => (a.room_number || '').localeCompare(b.room_number || ''));
    setAvailableRooms(sortedRooms.filter((r) => (r.max_beds || 1) - (r.occupied_beds || 0) > 0));
    const map = {};
    for (const p of rentRes.data) { map[p.tenant_id] = p; }
    setRentMap(map);
  }

  useEffect(() => { load(); }, []);

  // ── Generate Rent modal ─────────────────────────────────────────────────────

  async function openGenModal() {
    setGenMonth(currentMonth);
    setGenResult('');
    setShowGenModal(true);
    setLoadingTenants(true);
    try {
      const res = await api.get('/rent/tenants', { params: { month_year: currentMonth } });
      setTenantList(res.data);
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
      const res = await api.post('/rent/generate', { month_year: genMonth, tenant_ids: ids.length > 0 ? ids : undefined });
      setGenResult(`✓ ${res.data.message}`);
      await load();
      await refreshGenModal(genMonth);
    } catch (err) {
      setGenResult(err.response?.data?.detail || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  }

  const selectableCount = tenantList.filter((t) => !t.has_rent_generated).length;
  function toggleTenant(id) { setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() {
    const s = tenantList.filter((t) => !t.has_rent_generated).map((t) => t.id);
    setSelectedIds(selectedIds.size === s.length ? new Set() : new Set(s));
  }

  // ── Rent action modal ───────────────────────────────────────────────────────

  async function downloadReceipt(rentId) {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:8000/rent/${rentId}/receipt`, {
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

  async function markRentStatus(rid, status) {
    setRentActionId(rid);
    try {
      await api.put(`/rent/${rid}/status`, { status });
      setRentModal(null);
      await load();
    } finally { setRentActionId(null); }
  }

  async function verifyRent(rid) {
    setRentActionId(rid);
    try {
      await api.put(`/rent/${rid}/verify`);
      setRentModal(null);
      await load();
    } finally { setRentActionId(null); }
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async function handleAdd() {
    setError('');
    if (!form.phone?.trim()) { setError('Phone is required.'); return; }
    if (!PHONE_RE.test(form.phone)) { setError('Phone format: 03XX-XXXXXXX (e.g. 0300-1234567)'); return; }
    if (!form.cnic?.trim()) { setError('CNIC is required.'); return; }
    if (!CNIC_RE.test(form.cnic)) { setError('CNIC format: XXXXX-XXXXXXX-X (e.g. 35201-1234567-1)'); return; }
    if (!form.move_in_date) { setError('Move-in date is required.'); return; }
    setLoading(true);
    try {
      const res = await api.post('/tenants', form);
      setShowAdd(false);
      setForm({ name: '', email: '', phone: '', cnic: '', emergency_contact: '', move_in_date: '' });
      await load();
      if (form.email && res.data.temp_password)
        setCredModal({ email: form.email, password: res.data.temp_password, name: res.data.name });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add tenant');
    } finally { setLoading(false); }
  }

  async function handleAssign() {
    if (!selectedRoom) return;
    setLoading(true);
    try {
      await api.put(`/tenants/${assignModal.id}/assign-room`, {
        room_id: +selectedRoom,
        beds_taken: Math.max(1, +bedsTaken || 1),
        rent_due_day: Math.max(1, Math.min(28, +rentDueDay || 1)),
      });
      setAssignModal(null); setSelectedRoom(''); setBedsTaken(1); setRentDueDay(1);
      await load();
    } catch (err) { alert(err.response?.data?.detail || 'Failed'); }
    finally { setLoading(false); }
  }

  function handleVacate(t) {
    setConfirmModal({
      title: 'Vacate Tenant',
      message: `Remove ${t.name} from ${t.room_number}? Their rent records will be preserved.`,
      confirmLabel: 'Vacate',
      confirmClass: 'bg-yellow-600 hover:bg-yellow-700',
      onConfirm: async () => {
        setConfirmModal(null);
        setActionId(t.id);
        try { await api.put(`/tenants/${t.id}/vacate`); await load(); }
        finally { setActionId(null); }
      },
    });
  }

  function handleDelete(t) {
    setConfirmModal({
      title: 'Remove Tenant',
      message: `Permanently remove ${t.name}? This cannot be undone.`,
      confirmLabel: 'Remove',
      onConfirm: async () => {
        setConfirmModal(null);
        setActionId(t.id);
        try { await api.delete(`/tenants/${t.id}`); await load(); }
        finally { setActionId(null); }
      },
    });
  }

  function openEdit(t) {
    setEditModal(t);
    setEditForm({ name: t.name, phone: t.phone || '', cnic: t.cnic || '', emergency_contact: t.emergency_contact || '' });
    setEditError('');
  }

  async function handleEdit() {
    if (!editForm.name.trim()) { setEditError('Name is required.'); return; }
    setSavingEdit(true);
    try {
      await api.put(`/tenants/${editModal.id}`, editForm);
      setEditModal(null); await load();
    } catch (err) { setEditError(err.response?.data?.detail || 'Failed'); }
    finally { setSavingEdit(false); }
  }

  const sevenDaysAgo = Date.now() - 7*24*60*60*1000;
  const longUnassigned = tenants.filter((t) => !t.room_number && t.move_in_date && new Date(t.move_in_date).getTime() < sevenDaysAgo);

  const uniqueProperties = [...new Map(tenants.filter((t) => t.property_name).map((t) => [t.property_name, t.property_name])).values()];
  const filteredTenants = tenants.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.name?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q) || t.phone?.toLowerCase().includes(q);
    const matchProp = !propFilter || t.property_name === propFilter;
    return matchSearch && matchProp;
  });

  function copyToClipboard(text) { navigator.clipboard?.writeText(text).catch(() => {}); }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Tenants & Rent</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage tenants and current month rent — {currentMonth}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={openGenModal}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Generate Rent
          </button>
          <button onClick={() => { setShowAdd(true); setError(''); }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + Add Tenant
          </button>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {uniqueProperties.length > 1 && (
          <select value={propFilter} onChange={(e) => setPropFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Properties</option>
            {uniqueProperties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>

      {longUnassigned.length > 0 && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded-xl flex items-start gap-3">
          <span className="text-xl shrink-0">⚠</span>
          <div>
            <p className="text-sm font-semibold text-yellow-800">{longUnassigned.length} tenant{longUnassigned.length > 1 ? 's have' : ' has'} been unassigned for over 7 days.</p>
            <p className="text-xs text-yellow-700 mt-0.5">Review and assign rooms or remove them.</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-left">
                {['Name', 'Email', 'Phone', 'Room / Beds', 'Property', 'Move-in', `Rent ${currentMonth}`, 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                    <Users size={48} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-base font-medium text-gray-500">No tenants yet</p>
                    <p className="text-sm mt-1 mb-4">Add a property first, then add tenants</p>
                    <button onClick={() => window.location.href='/landlord/properties'} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Go to Properties</button>
                  </td>
                </tr>
              )}
              {filteredTenants.length === 0 && tenants.length > 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">No tenants match your search.</td>
                </tr>
              )}
              {filteredTenants.map((t) => {
                const payment = rentMap[t.id];
                const rentStatus = payment ? payment.status : 'none';
                return (
                  <tr key={t.id}
                    onClick={() => openDetailModal(t)}
                    className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3 font-medium text-blue-700 underline underline-offset-2">{t.name}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{t.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{t.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {t.room_number ? (
                        <div>
                          <span className="font-medium">{t.room_number}</span>
                          {t.beds_taken > 0 && <span className="text-xs text-gray-400 ml-1">· {t.beds_taken} bed{t.beds_taken > 1 ? 's' : ''}</span>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400 text-xs">Not assigned</span>
                          {longUnassigned.find((u) => u.id === t.id) && <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded font-medium">Unassigned</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{t.property_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{t.move_in_date ? fmtDate(t.move_in_date) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); if (payment) setRentModal({ tenant: t, payment }); }}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${rentStatus === 'none' ? 'bg-gray-100 text-gray-500' : (RENT_STYLES[rentStatus] || 'bg-gray-100 text-gray-500')} ${payment ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                      >
                        {RENT_LABELS[rentStatus] || rentStatus}
                        {payment && <span className="ml-1">₨{Number(payment.amount).toLocaleString()}</span>}
                      </button>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1.5 flex-wrap">
                        <button onClick={() => openEdit(t)} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 border border-gray-200">✏ Edit</button>
                        {!t.room_number ? (
                          <button onClick={() => { setAssignModal(t); setSelectedRoom(''); setRentDueDay(1); }} className="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 border border-blue-200">Assign Room</button>
                        ) : (
                          <button onClick={() => handleVacate(t)} disabled={actionId === t.id}
                            className="px-2 py-1 text-xs bg-yellow-50 text-yellow-700 rounded hover:bg-yellow-100 flex items-center gap-1 border border-yellow-200">
                            {actionId === t.id && <Spinner small />}Vacate
                          </button>
                        )}
                        <button onClick={() => handleDelete(t)} disabled={actionId === t.id}
                          className="px-2 py-1 text-xs bg-red-50 text-red-500 rounded hover:bg-red-100 border border-red-200">Remove</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tenant Detail Modal */}
      {detailModal && (
        <Modal title={detailModal.name} onClose={() => setDetailModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-4 text-sm">
              <div><p className="text-xs text-gray-400">Email</p><p className="text-gray-700">{detailModal.email || '—'}</p></div>
              <div><p className="text-xs text-gray-400">Phone</p><p className="text-gray-700">{detailModal.phone || '—'}</p></div>
              <div><p className="text-xs text-gray-400">CNIC</p><p className="text-gray-700">{detailModal.cnic || '—'}</p></div>
              <div><p className="text-xs text-gray-400">Emergency Contact</p><p className="text-gray-700">{detailModal.emergency_contact || '—'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="text-xs text-blue-500">Room</p>
                <p className="font-semibold text-gray-800">{detailModal.room_number || 'Unassigned'}</p>
                {detailModal.beds_taken > 0 && <p className="text-xs text-gray-500 mt-0.5">{detailModal.beds_taken} bed{detailModal.beds_taken > 1 ? 's' : ''} assigned</p>}
              </div>
              <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
                <p className="text-xs text-purple-500">Property</p>
                <p className="font-semibold text-gray-800">{detailModal.property_name || '—'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 rounded-xl p-3">
              <div><p className="text-xs text-gray-400">Move-in</p><p className="font-medium text-gray-700">{detailModal.move_in_date ? fmtDate(detailModal.move_in_date) : '—'}</p></div>
              <div>
                <p className="text-xs text-gray-400">Rent due</p>
                <p className="font-medium text-gray-700">{detailModal.rent_due_day ? `Day ${detailModal.rent_due_day} of month` : '—'}</p>
              </div>
            </div>

            {/* Rent history */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Rent History</p>
              {detailRentsLoading ? (
                <p className="text-xs text-gray-400 py-3 text-center">Loading...</p>
              ) : detailRents.length === 0 ? (
                <p className="text-xs text-gray-400 py-3 text-center">No rent entries yet.</p>
              ) : (
                <div className="max-h-52 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                  {detailRents.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50">
                      <div>
                        <span className="text-sm font-medium text-gray-700">{fmtMonthYear(r.month_year)}</span>
                        {r.due_date && <span className="text-xs text-gray-400 ml-2">due {fmtDate(r.due_date)}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800">₨{Number(r.amount).toLocaleString()}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RENT_STYLES[r.status] || 'bg-gray-100 text-gray-500'}`}>
                          {RENT_LABELS[r.status] || r.status}
                        </span>
                        {(r.status === 'pending' || r.status === 'overdue' || r.status === 'pending_verification') && (
                          <button
                            onClick={() => { setDetailModal(null); setRentModal({ tenant: detailModal, payment: r }); }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                            Manage
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDetailModal(null); openEdit(detailModal); }} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">✏ Edit</button>
              <button onClick={() => setDetailModal(null)} className="px-4 py-2 text-sm text-gray-600">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rent Action Modal */}
      {rentModal && (
        <Modal title={`Rent — ${rentModal.tenant.name} (${fmtMonthYear(rentModal.payment.month_year)})`} onClose={() => setRentModal(null)}>
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-xl">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-2xl font-bold text-gray-800">₨ {Number(rentModal.payment.amount).toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Due: {fmtDate(rentModal.payment.due_date)}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${RENT_STYLES[rentModal.payment.status]}`}>
                  {RENT_LABELS[rentModal.payment.status]}
                </span>
              </div>
            </div>
            {rentModal.payment.receipt_image && (
              <a href={`http://localhost:8000/uploads/${rentModal.payment.receipt_image}`} target="_blank" rel="noreferrer"
                className="block">
                <img src={`http://localhost:8000/uploads/${rentModal.payment.receipt_image}`} alt="receipt"
                  className="w-24 h-24 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
              </a>
            )}
            <div className="flex gap-2 flex-wrap">
              {rentModal.payment.status === 'pending_verification' && (
                <>
                  <button onClick={() => verifyRent(rentModal.payment.id)} disabled={!!rentActionId}
                    className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-1.5 disabled:opacity-60">
                    {rentActionId && <Spinner small />}✓ Confirm Payment
                  </button>
                  <button onClick={() => markRentStatus(rentModal.payment.id, 'pending')} disabled={!!rentActionId}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm border border-red-200 hover:bg-red-100">
                    ✗ Reject
                  </button>
                </>
              )}
              {(rentModal.payment.status === 'pending' || rentModal.payment.status === 'overdue') && (
                <button onClick={() => markRentStatus(rentModal.payment.id, 'paid')} disabled={!!rentActionId}
                  className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-1.5 disabled:opacity-60">
                  {rentActionId && <Spinner small />}Mark as Paid
                </button>
              )}
              {rentModal.payment.status === 'paid' && (
                <>
                  <button
                    onClick={() => downloadReceipt(rentModal.payment.id)}
                    className="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm border border-blue-200 hover:bg-blue-100 flex items-center gap-1.5"
                  >
                    <Download size={13} /> Download Receipt
                  </button>
                  <button onClick={() => markRentStatus(rentModal.payment.id, 'pending')} disabled={!!rentActionId}
                    className="px-3 py-2 bg-yellow-50 text-yellow-700 rounded-lg text-sm border border-yellow-200 hover:bg-yellow-100">
                    Mark as Pending
                  </button>
                </>
              )}
              <button onClick={() => setRentModal(null)} className="px-3 py-2 text-sm text-gray-600 ml-auto">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Generate Rent Modal */}
      {showGenModal && (
        <Modal title="Generate Rent" onClose={() => setShowGenModal(false)}>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Month:</label>
              <input type="month" value={genMonth} onChange={(e) => { setGenMonth(e.target.value); refreshGenModal(e.target.value); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            {loadingTenants ? (
              <div className="flex items-center gap-2 text-gray-400 py-4"><Spinner small /> Loading tenants...</div>
            ) : tenantList.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No tenants with rooms assigned.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={selectedIds.size === selectableCount && selectableCount > 0} onChange={toggleAll} className="rounded" />
                    Select All ({selectableCount} available)
                  </label>
                  <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                  {tenantList.map((t) => (
                    <label key={t.id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg cursor-pointer transition ${t.has_rent_generated ? 'opacity-50 bg-gray-50 cursor-not-allowed' : 'hover:bg-blue-50/50'}`}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={selectedIds.has(t.id)} onChange={() => !t.has_rent_generated && toggleTenant(t.id)} disabled={t.has_rent_generated} className="rounded" />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{t.name}</p>
                          <p className="text-xs text-gray-400">Room {t.room_number} · {t.beds_taken} bed{t.beds_taken > 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {t.has_rent_generated ? <span className="text-xs text-gray-400 italic">Already generated</span>
                          : <span className="text-sm font-semibold text-gray-700">₨ {Number(t.expected_amount).toLocaleString()}</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}
            {genResult && <p className={`text-sm font-medium ${genResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{genResult}</p>}
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowGenModal(false)} className="px-4 py-2 text-sm text-gray-600">Close</button>
              <button onClick={handleGenerate} disabled={generating || selectedIds.size === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 flex items-center gap-2 disabled:opacity-60">
                {generating && <Spinner small />}Generate for Selected ({selectedIds.size})
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Tenant Modal */}
      {showAdd && (
        <Modal title="Add Tenant" onClose={() => setShowAdd(false)}>
          {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-xs text-blue-700">A login account will be created using the tenant's email. Share the temp password once — it won't be shown again.</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Full Name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email * <span className="text-gray-400 font-normal text-xs">(used for login)</span></label>
              <input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="tenant@email.com" />
            </div>
            {[['phone','Phone *','text','03XX-XXXXXXX'],['cnic','CNIC *','text','XXXXX-XXXXXXX-X'],['emergency_contact','Emergency Contact','text','03XX-XXXXXXX'],['move_in_date','Move-in Date *','date','']].map(([key,label,type,placeholder]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                  {key === 'emergency_contact' && <span className="text-gray-400 font-normal text-xs"> (optional)</span>}
                </label>
                <input type={type} value={form[key]} onChange={(e) => setForm({...form,[key]:e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder={placeholder} />
              </div>
            ))}
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleAdd} disabled={loading || !form.name || !form.email}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {loading && <Spinner small />}Add Tenant
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Credentials Modal */}
      {credModal && (
        <Modal title="Tenant Created Successfully" onClose={() => setCredModal(null)}>
          <div className="space-y-4">
            <div className="p-4 bg-green-50 rounded-xl border border-green-200 text-center">
              <div className="text-3xl mb-2">✅</div>
              <p className="text-sm font-semibold text-green-800">Account created for {credModal.name}</p>
              <p className="text-xs text-green-600 mt-1">Share with tenant · <strong>password shown once only</strong></p>
            </div>
            {[['Email', credModal.email], ['Temp Password', credModal.password]].map(([label, val]) => (
              <div key={label}>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</label>
                <div className="flex gap-2 items-center">
                  <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-800">{val}</div>
                  <button onClick={() => copyToClipboard(val)} className="px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg">📋</button>
                </div>
              </div>
            ))}
            <button onClick={() => setCredModal(null)} className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">I've noted the credentials</button>
          </div>
        </Modal>
      )}

      {/* Assign Room Modal */}
      {assignModal && (
        <Modal title={`Assign Room — ${assignModal.name}`} onClose={() => setAssignModal(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Available Room</label>
              <select value={selectedRoom} onChange={(e) => { setSelectedRoom(e.target.value); setBedsTaken(1); }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Choose a room...</option>
                {availableRooms.map((r) => {
                  const avail = (r.max_beds || 1) - (r.occupied_beds || 0);
                  const ppb = r.price_per_bed || r.rent_amount || 0;
                  return <option key={r.id} value={r.id}>{r.room_number} — {r.property_name} · {avail} bed{avail !== 1 ? 's' : ''} avail · ₨{Number(ppb).toLocaleString()}/bed</option>;
                })}
              </select>
              {availableRooms.length === 0 && <p className="text-xs text-red-500 mt-1">No available rooms in approved properties.</p>}
            </div>
            {selectedRoom && (() => {
              const room = availableRooms.find((r) => String(r.id) === String(selectedRoom));
              if (!room) return null;
              const maxAvail = (room.max_beds || 1) - (room.occupied_beds || 0);
              const ppb = room.price_per_bed || room.rent_amount || 0;
              const rent = (Number(bedsTaken) || 1) * ppb;
              const isSingle = room.max_beds === 1;
              return (
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 text-sm">
                    <p className="text-blue-700 font-medium">Available: {maxAvail} beds · ₨ {Number(ppb).toLocaleString()} per bed</p>
                  </div>
                  {!isSingle && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">How many beds? (1–{maxAvail})</label>
                      <input type="number" min="1" max={maxAvail} value={bedsTaken}
                        onChange={(e) => setBedsTaken(Math.min(maxAvail, Math.max(1, +e.target.value || 1)))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  )}
                  <div className="p-3 bg-green-50 rounded-lg border border-green-100 text-sm font-semibold text-green-700">
                    Monthly rent: ₨ {Number(rent).toLocaleString()}
                    {!isSingle && <span className="text-xs font-normal text-green-600"> ({bedsTaken} bed{bedsTaken > 1 ? 's' : ''} × ₨{Number(ppb).toLocaleString()})</span>}
                  </div>
                </div>
              );
            })()}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rent Due Day (1–28)</label>
              <input
                type="number" min="1" max="28" value={rentDueDay}
                onChange={(e) => setRentDueDay(Math.max(1, Math.min(28, +e.target.value || 1)))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Rent auto-generates on this day each month</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setAssignModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleAssign} disabled={loading || !selectedRoom} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {loading && <Spinner small />}Assign Room
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          confirmClass={confirmModal.confirmClass}
          onConfirm={confirmModal.onConfirm}
          onClose={() => setConfirmModal(null)}
        />
      )}

      {/* Edit Tenant Modal */}
      {editModal && (
        <Modal title={`Edit Tenant — ${editModal.name}`} onClose={() => setEditModal(null)}>
          {editError && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{editError}</div>}
          <div className="space-y-3">
            {[['name','Name *','text'],['phone','Phone *','text'],['cnic','CNIC *','text'],['emergency_contact','Emergency Contact','text']].map(([key,label,type]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <input type={type} value={editForm[key]} onChange={(e) => setEditForm({...editForm,[key]:e.target.value})} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            ))}
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setEditModal(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleEdit} disabled={savingEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {savingEdit && <Spinner small />}Save Changes
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
