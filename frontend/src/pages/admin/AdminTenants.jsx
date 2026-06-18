import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserCheck, X, ExternalLink, Download } from 'lucide-react';
import { fmtDate, fmtMonthYear, toTitleCase } from '../../utils/format.jsx';

import { BASE_URL as BASE } from '../../api/config';
const token = () => localStorage.getItem('token');
const authHeaders = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

const NA = () => <span className="text-gray-400 text-sm">Not set</span>;
const NP = () => <span className="text-gray-400 text-sm">Not provided</span>;

const RENT_STATUS = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  pending_verification: 'bg-orange-100 text-orange-700',
};

function TenantDetailModal({ tid, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function downloadReceipt(rentId) {
    try {
      const res = await fetch(`${BASE}/rent/${rentId}/receipt`, {
        headers: { Authorization: `Bearer ${token()}` },
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

  useEffect(() => {
    fetch(`${BASE}/admin/tenants/${tid}/detail`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tid]);

  const t = data?.tenant;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-lg text-gray-800">{t ? toTitleCase(t.name) : 'Tenant Detail'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="py-8 text-center text-gray-400">Loading...</div>
          ) : !data ? (
            <div className="py-8 text-center text-red-400">Failed to load tenant details.</div>
          ) : (
            <>
              {/* Personal info */}
              <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-4 text-sm">
                <div><p className="text-xs text-gray-400">Email</p><p className="text-gray-700">{t.email || <NP />}</p></div>
                <div><p className="text-xs text-gray-400">Phone</p><p className="text-gray-700">{t.phone || <NP />}</p></div>
                <div><p className="text-xs text-gray-400">CNIC</p><p className="text-gray-700">{t.cnic || <NP />}</p></div>
                <div><p className="text-xs text-gray-400">Emergency Contact</p><p className="text-gray-700">{t.emergency_contact || <NP />}</p></div>
              </div>

              {/* Property + Room cards */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs text-blue-500 font-medium mb-1">Property</p>
                  <p className="font-semibold text-gray-800">{toTitleCase(t.property_name) || <NP />}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t.property_address || <NP />}</p>
                  <p className="text-xs text-gray-400 mt-0.5 capitalize">{t.property_type?.replace('_', ' ') || ''}</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs text-blue-500 font-medium mb-1">Room</p>
                  {t.room_number ? (
                    <>
                      <p className="font-semibold text-gray-800">Room {t.room_number}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.beds_taken || 1} of {t.max_beds || 1} beds assigned</p>
                      <p className="text-xs text-gray-600 font-medium mt-1">₨ {Number((t.price_per_bed || 0) * (t.beds_taken || 1)).toLocaleString()}/mo</p>
                    </>
                  ) : <p className="text-gray-400 text-sm">Unassigned</p>}
                </div>
              </div>

              {/* Move-in + Landlord */}
              <div className="flex gap-6 text-sm bg-gray-50 rounded-xl p-4">
                <div>
                  <p className="text-xs text-gray-400">Move-in Date</p>
                  <p className="font-medium text-gray-700 mt-0.5">{t.move_in_date ? fmtDate(t.move_in_date) : <NP />}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Landlord</p>
                  <p className="font-medium text-gray-700 mt-0.5">{toTitleCase(t.landlord_name) || <NP />}</p>
                </div>
              </div>

              {/* Rent history */}
              {data.rent_history?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700 text-sm mb-2">Rent History (Last 6 Months)</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-left">
                        <th className="py-1">Month</th><th>Amount</th><th>Status</th><th>Paid On</th><th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rent_history.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100">
                          <td className="py-1.5">{fmtMonthYear(r.month_year) || r.month_year}</td>
                          <td>₨ {Number(r.amount).toLocaleString()}</td>
                          <td>
                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${RENT_STATUS[r.status] || 'bg-gray-100 text-gray-500'}`}>
                              {toTitleCase((r.status || '').replace('_', ' '))}
                            </span>
                          </td>
                          <td className="text-gray-400">{r.paid_at ? fmtDate(r.paid_at) : '—'}</td>
                          <td>
                            {r.status === 'paid' && (
                              <button onClick={() => downloadReceipt(r.id)}
                                className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100 border border-blue-200">
                                <Download size={10} /> PDF
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between">
          {t ? (
            <div className="flex items-center gap-3">
              {t.landlord_id && (
                <button onClick={() => { onClose(); navigate(`/admin/landlords/${t.landlord_id}`); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-200">
                  <ExternalLink size={13} /> View Landlord
                </button>
              )}
            </div>
          ) : <div />}
          <button onClick={onClose} className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminTenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [landlordFilter, setLandlordFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('active');
  const [detailId, setDetailId] = useState(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    fetch(`${BASE}/admin/tenants`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) { setError(`Error: ${res.status}`); return; }
        setTenants(await res.json());
      })
      .catch((e) => setError(`Network error: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  // Open tenant from URL param (?id=...)
  useEffect(() => {
    const id = searchParams.get('id');
    if (id) setDetailId(Number(id));
  }, [searchParams]);

  const sorted = [...tenants].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const landlordNames = [...new Set(sorted.map((t) => t.landlord_name).filter(Boolean))].sort();

  const activeTenants = sorted.filter((t) => !t.deactivated_by_landlord && (t.landlord_status === 'active' || !t.landlord_status));
  const inactiveTenants = sorted.filter((t) => t.deactivated_by_landlord || t.landlord_status === 'inactive');
  const tabTenants = activeTab === 'active' ? activeTenants : inactiveTenants;

  const filtered = tabTenants.filter((t) => {
    const matchSearch = !search ||
      t.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.email?.toLowerCase().includes(search.toLowerCase()) ||
      t.landlord_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.property_name?.toLowerCase().includes(search.toLowerCase());
    const matchLandlord = landlordFilter === 'all' || t.landlord_name === landlordFilter;
    return matchSearch && matchLandlord;
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">All Tenants</h1>
          <p className="text-sm text-gray-500 mt-0.5">{tenants.length} tenants across all landlords · Click a row to view details</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-gray-100 p-1 w-fit mb-4">
        {[{ key: 'active', label: `Active (${activeTenants.length})` }, { key: 'inactive', label: `Inactive (${inactiveTenants.length})` }].map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-5 py-1.5 rounded-md text-sm font-medium transition ${activeTab === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <input type="text" placeholder="Search tenants…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={landlordFilter} onChange={(e) => setLandlordFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Landlords</option>
          {landlordNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide text-left">
                {['Tenant', 'Email', 'Phone', 'Landlord', 'Property', 'Room', 'Move-in'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
                {activeTab === 'inactive' && <th className="px-4 py-3 font-semibold whitespace-nowrap">Reason</th>}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={activeTab === 'inactive' ? 8 : 7} className="px-4 py-12 text-center text-gray-400">Loading...</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={activeTab === 'inactive' ? 8 : 7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <UserCheck size={32} className="opacity-30" />
                      <p className="text-sm">No tenants found.</p>
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((t) => (
                <tr key={t.id}
                  onClick={() => setDetailId(t.id)}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition">
                  <td className="px-4 py-3 font-medium text-blue-700 underline underline-offset-2">{toTitleCase(t.name)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t.email || <NA />}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t.phone || <NA />}</td>
                  <td className="px-4 py-3 text-gray-700">{toTitleCase(t.landlord_name) || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{toTitleCase(t.property_name) || '—'}</td>
                  <td className="px-4 py-3">
                    {t.room_number
                      ? <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{t.room_number}</span>
                      : <span className="text-gray-400 text-xs">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {t.move_in_date ? fmtDate(t.move_in_date) : <NA />}
                  </td>
                  {activeTab === 'inactive' && (
                    <td className="px-4 py-3">
                      {t.deactivated_by_landlord
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Deactivated by Landlord</span>
                        : t.landlord_status === 'inactive'
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">Landlord Inactive</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Inactive</span>
                      }
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailId && <TenantDetailModal tid={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
