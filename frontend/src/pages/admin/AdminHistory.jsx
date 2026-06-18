import { useEffect, useState } from 'react';
import { Search, Clock, X } from 'lucide-react';
import { fmtDate, fmtMonthYear, toTitleCase, fmtCurrency } from '../../utils/format.jsx';

import { BASE_URL as BASE } from '../../api/config';
const token = () => localStorage.getItem('token');
const authHeaders = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

const NA = () => <span className="text-gray-400 text-sm">Not set</span>;

function statusBadge(l) {
  if (l.is_deleted) return <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-600">Deleted</span>;
  if (l.status === 'active' || l.status === 'approved') return <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>;
  if (l.status === 'inactive') return <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Inactive</span>;
  if (l.status === 'pending') return <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-600">Pending</span>;
  return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">{toTitleCase(l.status)}</span>;
}

function LandlordDetailModal({ lid, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/admin/history/${lid}/detail`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [lid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-lg text-gray-800">Landlord History Detail</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-8 text-center text-gray-400">Loading...</div>
          ) : !data ? (
            <div className="py-8 text-center text-red-400">Failed to load details.</div>
          ) : (
            <>
              {/* Info */}
              <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-xl p-4">
                <div><p className="text-xs text-gray-400">Business Name</p><p className="font-semibold text-gray-800">{toTitleCase(data.landlord.business_name) || '—'}</p></div>
                <div><p className="text-xs text-gray-400">Email</p><p className="text-gray-700 text-sm">{data.landlord.user_email || data.landlord.email || '—'}</p></div>
                <div><p className="text-xs text-gray-400">Phone</p><p className="text-gray-700 text-sm">{data.landlord.phone || '—'}</p></div>
                <div><p className="text-xs text-gray-400">CNIC</p><p className="text-gray-700 text-sm">{data.landlord.cnic || '—'}</p></div>
                <div><p className="text-xs text-gray-400">Status</p><p className="capitalize text-gray-700 text-sm">{toTitleCase(data.landlord.status)}</p></div>
                <div><p className="text-xs text-gray-400">Registered</p><p className="text-gray-700 text-sm">{data.landlord.created_at ? fmtDate(data.landlord.created_at) : '—'}</p></div>
                {data.landlord.deleted_at && (
                  <div><p className="text-xs text-gray-400">Deleted On</p><p className="text-red-600 text-sm">{fmtDate(data.landlord.deleted_at)}</p></div>
                )}
                <div><p className="text-xs text-gray-400">Monthly Fee</p><p className="font-semibold text-gray-800">{data.landlord.monthly_fee > 0 ? fmtCurrency(data.landlord.monthly_fee) : <NA />}</p></div>
              </div>

              {/* Revenue */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                  <p className="text-xs text-green-600">Total Rent Revenue</p>
                  <p className="text-xl font-bold text-green-700 mt-1">{fmtCurrency(data.total_rent_revenue || 0)}</p>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <p className="text-xs text-blue-600">Platform Fees Paid</p>
                  <p className="text-xl font-bold text-blue-700 mt-1">{fmtCurrency(data.total_platform_fees_paid || 0)}</p>
                </div>
              </div>

              {/* Properties */}
              {data.properties?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700 text-sm mb-2">Properties ({data.properties.length})</h3>
                  <div className="space-y-1">
                    {data.properties.map((p) => (
                      <div key={p.id} className="flex justify-between text-sm px-3 py-2 bg-gray-50 rounded-lg">
                        <span className="text-gray-700">{toTitleCase(p.name)}</span>
                        <div className="flex gap-3 text-gray-500 text-xs">
                          <span>{p.total_rooms} rooms</span>
                          <span className={`capitalize ${p.status === 'approved' ? 'text-green-600' : 'text-yellow-600'}`}>{p.status?.replace('_', ' ')}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Tenants */}
              {data.tenants?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700 text-sm mb-2">Tenants ({data.tenants.length})</h3>
                  <div className="space-y-1">
                    {data.tenants.map((t) => (
                      <div key={t.id} className="flex justify-between text-sm px-3 py-2 bg-gray-50 rounded-lg">
                        <span className="text-gray-700">{toTitleCase(t.name)}</span>
                        <div className="flex gap-3 text-gray-500 text-xs">
                          <span>{t.room_number ? `Room ${t.room_number}` : 'Unassigned'}</span>
                          <span>{t.move_in_date ? fmtDate(t.move_in_date) : '—'}</span>
                          <span className={t.is_active ? 'text-green-600' : 'text-red-500'}>{t.is_active ? 'Active' : 'Inactive'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deleted Tenants */}
              {data.deleted_tenants?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700 text-sm mb-2">Deleted Tenants ({data.deleted_tenants.length})</h3>
                  <div className="space-y-1">
                    {data.deleted_tenants.map((t) => (
                      <div key={t.id} className="flex justify-between text-sm px-3 py-2 bg-red-50 rounded-lg opacity-75">
                        <span className="text-gray-700">{toTitleCase(t.name)}</span>
                        <span className="text-red-500 text-xs">{t.deleted_at ? fmtDate(t.deleted_at) : '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Platform payments */}
              {data.platform_payments?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-700 text-sm mb-2">Platform Fee History</h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-left">
                        <th className="py-1">Month</th><th>Amount</th><th>Status</th><th>Paid On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.platform_payments.map((p) => (
                        <tr key={p.id} className="border-t border-gray-100">
                          <td className="py-1.5">{fmtMonthYear(p.month_year) || p.month_year}</td>
                          <td>{fmtCurrency(p.amount)}</td>
                          <td><span className={p.status === 'paid' ? 'text-green-600' : 'text-yellow-600'}>{toTitleCase(p.status)}</span></td>
                          <td className="text-gray-400">{p.paid_at ? fmtDate(p.paid_at) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminHistory() {
  const [tab, setTab] = useState('landlords');
  const [landlords, setLandlords] = useState([]);
  const [tenantHistory, setTenantHistory] = useState({ active: [], deleted: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [detailId, setDetailId] = useState(null);
  const [search, setSearch] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/admin/history`, { headers: authHeaders() }),
      fetch(`${BASE}/admin/tenant-history`, { headers: authHeaders() }),
    ]).then(async ([lr, tr]) => {
      if (lr.ok) setLandlords(await lr.json());
      else setError(`Error loading landlords: ${lr.status}`);
      if (tr.ok) setTenantHistory(await tr.json());
    }).catch((e) => setError(`Network error: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const filteredLandlords = [...landlords]
    .sort((a, b) => (a.business_name || a.name || '').localeCompare(b.business_name || b.name || ''))
    .filter((l) => {
      if (filter === 'active') return !l.is_deleted && (l.status === 'active' || l.status === 'approved');
      if (filter === 'deleted') return !!l.is_deleted;
      return true;
    })
    .filter((l) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (l.business_name || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q);
    });

  const allTenants = [
    ...tenantHistory.active.map((t) => ({ ...t, record_type: 'active' })),
    ...tenantHistory.deleted.map((t) => ({ ...t, record_type: 'deleted' })),
  ];
  const filteredTenants = [...allTenants]
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .filter((t) => {
      if (tenantFilter === 'active') return t.record_type === 'active';
      if (tenantFilter === 'deleted') return t.record_type === 'deleted';
      return true;
    })
    .filter((t) => {
      if (!tenantSearch) return true;
      const q = tenantSearch.toLowerCase();
      return (t.name || '').toLowerCase().includes(q) || (t.email || '').toLowerCase().includes(q);
    });

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">History</h1>
        <p className="text-sm text-gray-500 mt-0.5">Full audit history of all landlords and tenants.</p>
      </div>

      {/* Main tabs */}
      <div className="flex rounded-lg bg-gray-100 p-1 w-fit mb-6">
        {[{ key: 'landlords', label: 'Landlords' }, { key: 'tenants', label: 'Tenants' }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-1.5 rounded-md text-sm font-medium transition ${tab === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>}

      {/* Landlords Tab */}
      {tab === 'landlords' && (
        <>
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search by name or email…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex rounded-lg bg-gray-100 p-1">
              {[{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'deleted', label: 'Deleted' }].map((t) => (
                <button key={t.key} onClick={() => setFilter(t.key)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${filter === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">Click a row to view full landlord detail</p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide text-left">
                    {['Business', 'Email', 'Monthly Fee', 'Fees Paid', 'Properties', 'Tenants', 'Registered', 'Deleted On', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>}
                  {!loading && filteredLandlords.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <Clock size={28} className="opacity-30" />
                          <p className="text-sm">{search ? 'No records match your search.' : 'No history records yet.'}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredLandlords.map((l) => (
                    <tr key={l.id}
                      onClick={() => setDetailId(l.id)}
                      className={`border-t border-gray-100 hover:bg-blue-50/40 cursor-pointer transition ${!!l.is_deleted ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-medium text-blue-700 underline underline-offset-2">
                        {toTitleCase(l.business_name)}
                        {!!l.is_deleted && <span className="ml-1 text-xs text-red-400 no-underline">(deleted)</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{l.email}</td>
                      <td className="px-4 py-3">
                        {(l.monthly_fee || 0) > 0 ? fmtCurrency(l.monthly_fee) : <NA />}
                      </td>
                      <td className="px-4 py-3 text-green-700 font-medium">{fmtCurrency(l.fees_paid || 0)}</td>
                      <td className="px-4 py-3 text-center">{l.property_count || 0}</td>
                      <td className="px-4 py-3 text-center">{l.tenant_count || 0}</td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                        {l.created_at ? fmtDate(l.created_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                        {l.deleted_at ? fmtDate(l.deleted_at) : '—'}
                      </td>
                      <td className="px-4 py-3">{statusBadge(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Tenants Tab */}
      {tab === 'tenants' && (
        <>
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search by name or email…" value={tenantSearch}
                onChange={(e) => setTenantSearch(e.target.value)}
                className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex rounded-lg bg-gray-100 p-1">
              {[{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'deleted', label: 'Deleted' }].map((t) => (
                <button key={t.key} onClick={() => setTenantFilter(t.key)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tenantFilter === t.key ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide text-left">
                    {['Name', 'Email', 'Phone', 'Landlord', 'Property', 'Room', 'Move-in', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>}
                  {!loading && filteredTenants.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <Clock size={28} className="opacity-30" />
                          <p className="text-sm">No history records yet.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filteredTenants.map((t, i) => (
                    <tr key={`${t.record_type}-${t.id}-${i}`}
                      className={`border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition ${t.record_type === 'deleted' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-800">{toTitleCase(t.name)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{t.email || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{t.phone || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{toTitleCase(t.landlord_name) || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{toTitleCase(t.property_name) || '—'}</td>
                      <td className="px-4 py-3">{t.room_number ? `Room ${t.room_number}` : <NA />}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {t.move_in_date ? fmtDate(t.move_in_date) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {t.record_type === 'deleted'
                          ? <div>
                              <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full font-medium">Deleted</span>
                              <p className="text-xs text-gray-400 mt-0.5">{t.deleted_at ? fmtDate(t.deleted_at) : ''}</p>
                            </div>
                          : t.deactivated_by_landlord
                          ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Deactivated by Landlord</span>
                          : t.landlord_status === 'inactive'
                          ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">Landlord Inactive</span>
                          : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {detailId && <LandlordDetailModal lid={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
