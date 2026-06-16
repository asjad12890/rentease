import { useEffect, useState } from 'react';
import { Building, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import Spinner from '../../components/Spinner';
import { fmtDate, toTitleCase } from '../../utils/format.jsx';

const BASE = 'http://localhost:8000';
const token = () => localStorage.getItem('token');
const authHeaders = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

const ITEMS_PER_PAGE = 10;

const CAT_BADGE = {
  hostel_room:  'bg-blue-100 text-blue-700',
  apartment:    'bg-purple-100 text-purple-700',
  whole_house:  'bg-green-100 text-green-700',
  house_room:   'bg-orange-100 text-orange-700',
  hostel:       'bg-blue-100 text-blue-700',
  house:        'bg-green-100 text-green-700',
};

function StatusBadge({ status }) {
  const map = { approved: 'bg-green-100 text-green-700', pending_approval: 'bg-yellow-100 text-yellow-700', rejected: 'bg-red-100 text-red-600' };
  const labels = { approved: 'Approved', pending_approval: 'Pending', rejected: 'Rejected' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-500'}`}>{labels[status] || status}</span>;
}

function ConfirmModal({ title, message, confirmLabel, confirmClass, onConfirm, onClose }) {
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
          <button onClick={onConfirm} className={`px-4 py-2 text-sm text-white rounded-lg ${confirmClass}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function PropertyDetailModal({ pid, onClose, onActionDone }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(null);
  const [confirmReject, setConfirmReject] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`${BASE}/admin/properties/${pid}/detail`, { headers: authHeaders() });
    setData(res.ok ? await res.json() : null);
    setLoading(false);
  }

  useEffect(() => { load(); }, [pid]);

  async function handleAction(action) {
    setActioning(action);
    try {
      const res = await fetch(`${BASE}/admin/properties/${pid}/${action}`, { method: 'PUT', headers: authHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Error'); return; }
      await load();
      onActionDone();
    } finally { setActioning(null); }
  }

  const isPending = data?.status === 'pending_approval';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-lg text-gray-800">{data ? toTitleCase(data.name) : 'Property Detail'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="py-8 text-center text-gray-400">Loading...</div>
          ) : !data ? (
            <div className="py-8 text-center text-red-400">Failed to load property details.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-4 text-sm">
                <div><p className="text-xs text-gray-400">Address</p><p className="text-gray-700">{data.address || '—'}</p></div>
                <div><p className="text-xs text-gray-400">Type</p><p className="text-gray-700 capitalize">{(data.category || data.property_type || '').replace('_', ' ')}</p></div>
                <div><p className="text-xs text-gray-400">Landlord</p><p className="text-gray-700">{toTitleCase(data.landlord_name)}</p></div>
                <div><p className="text-xs text-gray-400">Status</p><StatusBadge status={data.status || 'approved'} /></div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-700 text-sm mb-3">Rooms ({data.rooms?.length || 0})</h3>
                <div className="space-y-3">
                  {(data.rooms || []).map((r) => {
                    const pct = r.max_beds > 0 ? Math.round((r.occupied_beds / r.max_beds) * 100) : 0;
                    const barColor = pct === 0 ? 'bg-green-400' : pct === 100 ? 'bg-red-500' : 'bg-blue-500';
                    return (
                      <div key={r.id} className="border border-gray-200 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-gray-800">Room {r.room_number}</span>
                          <span className="text-sm text-gray-600">₨ {Number(r.price_per_bed || r.rent_amount || 0).toLocaleString()}/bed</span>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{r.occupied_beds || 0}/{r.max_beds || 1} beds</span>
                        </div>
                        {r.tenants?.length === 0 ? (
                          <p className="text-xs text-gray-400 italic">Vacant</p>
                        ) : (
                          <div className="space-y-1">
                            {r.tenants?.map((t) => (
                              <div key={t.id} className="flex justify-between text-xs bg-gray-50 rounded px-2 py-1">
                                <span className="text-gray-700 font-medium">{toTitleCase(t.name)}</span>
                                <div className="flex gap-3 text-gray-500">
                                  <span>{t.beds_taken} bed{t.beds_taken > 1 ? 's' : ''}</span>
                                  <span>₨ {Number(t.monthly_rent || 0).toLocaleString()}/mo</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between">
          {!loading && data && isPending ? (
            <div className="flex gap-2">
              <button onClick={() => handleAction('approve')} disabled={!!actioning}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-60">
                {actioning === 'approve' && <Spinner small />}Approve
              </button>
              <button onClick={() => setConfirmReject(true)} disabled={!!actioning}
                className="px-4 py-2 text-sm bg-red-100 text-red-600 rounded-lg hover:bg-red-200 border border-red-200 disabled:opacity-60">
                Reject
              </button>
            </div>
          ) : <div />}
          <button onClick={onClose} className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition">
            Close
          </button>
        </div>
      </div>

      {confirmReject && data && (
        <ConfirmModal
          title="Reject Property"
          message={`Are you sure you want to reject "${toTitleCase(data.name)}"?`}
          confirmLabel="Reject"
          confirmClass="bg-red-600 hover:bg-red-700"
          onConfirm={() => { setConfirmReject(false); handleAction('reject'); }}
          onClose={() => setConfirmReject(false)}
        />
      )}
    </div>
  );
}

export default function AdminProperties() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [actioning, setActioning] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [page, setPage] = useState(1);
  const [confirmReject, setConfirmReject] = useState(null);

  async function load() {
    const res = await fetch(`${BASE}/admin/properties`, { headers: authHeaders() });
    if (!res.ok) { setError(`Error: ${res.status}`); setLoading(false); return; }
    setProperties(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(pid, action, e) {
    e?.stopPropagation();
    setActioning(pid + action);
    try {
      const res = await fetch(`${BASE}/admin/properties/${pid}/${action}`, { method: 'PUT', headers: authHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || 'Error'); return; }
      await load();
    } finally { setActioning(null); }
  }

  const filtered = [...properties]
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .filter((p) => {
      const matchSearch = !search ||
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.landlord_name?.toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter === 'all' ? true :
        filter === 'pending' ? p.status === 'pending_approval' :
        filter === 'approved' ? p.status === 'approved' :
        p.status === 'rejected';
      return matchSearch && matchFilter;
    });

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const pendingCount = properties.filter((p) => p.status === 'pending_approval').length;

  function handleFilterChange(f) { setFilter(f); setPage(1); }
  function handleSearch(v) { setSearch(v); setPage(1); }

  return (
    <div className="p-8">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-800">All Properties</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {properties.length} properties · {pendingCount} pending approval · Click a row to view details
        </p>
      </div>

      <div className="mb-5">
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search properties…" value={search} onChange={(e) => handleSearch(e.target.value)}
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="flex rounded-lg bg-gray-100 p-1 w-fit mb-5">
        {[
          { key: 'all', label: 'All' },
          { key: 'pending', label: `Pending${pendingCount ? ` (${pendingCount})` : ''}` },
          { key: 'approved', label: 'Approved' },
          { key: 'rejected', label: 'Rejected' },
        ].map((t) => (
          <button key={t.key} onClick={() => handleFilterChange(t.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${filter === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide text-left">
                {['Property Name', 'Address', 'Category', 'Landlord', 'Units', 'Total Beds', 'Vacant Beds', 'Submitted', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Building size={32} className="opacity-30" />
                      <p className="text-sm">No properties found.</p>
                    </div>
                  </td>
                </tr>
              )}
              {paginated.map((p) => (
                <tr key={p.id}
                  onClick={() => setDetailId(p.id)}
                  className={`border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition ${p.status === 'pending_approval' ? 'bg-yellow-50/30' : ''}`}>
                  <td className="px-4 py-3 font-medium text-blue-700 underline underline-offset-2">{toTitleCase(p.name)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.address || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${CAT_BADGE[p.category] || 'bg-gray-100 text-gray-600'}`}>
                      {(p.category || p.property_type || '').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{toTitleCase(p.landlord_name) || '—'}</td>
                  <td className="px-4 py-3 text-center font-medium">{p.total_rooms || 0}</td>
                  <td className="px-4 py-3 text-center">{p.total_beds || 0}</td>
                  <td className="px-4 py-3 text-center">
                    {(() => { const v = (p.total_beds || 0) - (p.occupied_beds || 0); return v > 0 ? <span className="text-green-600 font-medium">{v}</span> : <span className="text-gray-400">0</span>; })()}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {p.created_at ? fmtDate(p.created_at) : '—'}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.status || 'approved'} /></td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {p.status === 'pending_approval' && (
                      <div className="flex gap-1.5">
                        <button onClick={(e) => handleAction(p.id, 'approve', e)} disabled={!!actioning}
                          className="px-2.5 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60">
                          {actioning === p.id + 'approve' ? '...' : 'Approve'}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmReject(p); }} disabled={!!actioning}
                          className="px-2.5 py-1 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200 border border-red-200 disabled:opacity-60">
                          Reject
                        </button>
                      </div>
                    )}
                    {p.status === 'approved' && (
                      <button onClick={(e) => { e.stopPropagation(); setDetailId(p.id); }}
                        className="px-2.5 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-200">
                        View
                      </button>
                    )}
                    {p.status === 'rejected' && (
                      <button onClick={(e) => handleAction(p.id, 'approve', e)} disabled={!!actioning}
                        className="px-2.5 py-1 text-xs bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 border border-blue-200 disabled:opacity-60">
                        Re-approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40">
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setPage(n)}
                  className={`w-8 h-8 rounded-lg text-xs font-medium transition ${n === page ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {n}
                </button>
              ))}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {detailId && (
        <PropertyDetailModal pid={detailId} onClose={() => setDetailId(null)} onActionDone={load} />
      )}

      {confirmReject && (
        <ConfirmModal
          title="Reject Property"
          message={`Are you sure you want to reject "${toTitleCase(confirmReject.name)}"?`}
          confirmLabel="Reject"
          confirmClass="bg-red-600 hover:bg-red-700"
          onConfirm={() => { setConfirmReject(null); handleAction(confirmReject.id, 'reject'); }}
          onClose={() => setConfirmReject(null)}
        />
      )}
    </div>
  );
}
