import { useEffect, useState } from 'react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import { Bell, Trash2, FileText } from 'lucide-react';
import { fmtDate } from '../../utils/format.jsx';

const MAX_MSG = 500;

function ConfirmModal({ message, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-800 text-base mb-2">Delete Notice</h3>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg">Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function Notices() {
  const [notices, setNotices] = useState([]);
  const [properties, setProperties] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [recipientType, setRecipientType] = useState('all'); // 'all' | 'property' | 'tenant'
  const [form, setForm] = useState({ title: '', message: '', property_id: '', tenant_id: '' });
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // notice id
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const [nRes, pRes, tRes] = await Promise.all([api.get('/notices'), api.get('/properties'), api.get('/tenants')]);
    setNotices(nRes.data);
    setProperties(pRes.data);
    setTenants(tRes.data);
  }

  useEffect(() => { load(); }, []);

  async function handlePost() {
    setError('');
    setLoading(true);
    try {
      const payload = { title: form.title, message: form.message };
      if (recipientType === 'property' && form.property_id) payload.property_id = +form.property_id;
      if (recipientType === 'tenant' && form.tenant_id) payload.tenant_id = +form.tenant_id;
      await api.post('/notices', payload);
      setForm({ title: '', message: '', property_id: '', tenant_id: '' });
      setRecipientType('all');
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  function handleDeleteClick(id) {
    setConfirmDelete(id);
  }

  async function confirmDeleteNotice() {
    const id = confirmDelete;
    setConfirmDelete(null);
    setDeletingId(id);
    try {
      await api.delete(`/notices/${id}`);
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  const previewRecipient = recipientType === 'property'
    ? (properties.find((p) => String(p.id) === form.property_id)?.name || 'Specific Property')
    : recipientType === 'tenant'
      ? (tenants.find((t) => String(t.id) === form.tenant_id)?.name || 'Specific Tenant')
      : 'All Tenants';

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Notices</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Post form */}
        <div className="lg:col-span-1 bg-white rounded-xl p-6 shadow-sm border border-gray-100 h-fit">
          <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2"><Bell size={16} className="text-blue-500" /> Post a Notice</h2>
          {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Water Supply Interruption" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recipients</label>
              <select value={recipientType} onChange={(e) => { setRecipientType(e.target.value); setForm({ ...form, property_id: '', tenant_id: '' }); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="all">All Tenants</option>
                <option value="property">Specific Property</option>
                <option value="tenant">Specific Tenant</option>
              </select>
            </div>
            {recipientType === 'property' && (
              <select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Choose property...</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {recipientType === 'tenant' && (
              <select value={form.tenant_id} onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Choose tenant...</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Message *</label>
                <span className={`text-xs ${form.message.length > MAX_MSG ? 'text-red-500' : 'text-gray-400'}`}>{form.message.length}/{MAX_MSG}</span>
              </div>
              <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={4}
                placeholder="Write your notice here..." maxLength={MAX_MSG + 50} />
            </div>
            <button onClick={handlePost}
              disabled={loading || !form.title || !form.message || form.message.length > MAX_MSG}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
              {loading && <Spinner small />} Post Notice
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="lg:col-span-1">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Preview</h2>
          <div className="bg-white rounded-xl p-4 border border-blue-100 shadow-sm min-h-[120px]">
            {form.title || form.message ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Bell size={14} className="text-blue-500" />
                  <span className="font-semibold text-gray-800 text-sm">{form.title || 'Notice Title'}</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">To: {previewRecipient}</p>
                <p className="text-sm text-gray-700 leading-relaxed">{form.message || 'Your message will appear here...'}</p>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-gray-300">
                <FileText size={32} className="mb-2" />
                <p className="text-xs">Fill the form to see preview</p>
              </div>
            )}
          </div>
        </div>

        {/* Sent notices */}
        <div className="lg:col-span-1">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Sent Notices ({notices.length})</h2>
          {notices.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Bell size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="font-medium text-gray-500">No notices posted yet</p>
              <p className="text-sm mt-1">Use the form to post your first notice</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {notices.map((n) => (
                <div key={n.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:border-gray-200 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-800 text-sm truncate">{n.title}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {n.property_name || 'All Properties'} · {fmtDate(n.created_at)}
                      </p>
                      <p className="text-sm text-gray-600 mt-1.5 line-clamp-2">{n.message}</p>
                    </div>
                    <button onClick={() => handleDeleteClick(n.id)} disabled={deletingId === n.id}
                      className="shrink-0 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                      {deletingId === n.id ? <Spinner small /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          message="Delete this notice? Tenants who received it will no longer see it."
          onConfirm={confirmDeleteNotice}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
