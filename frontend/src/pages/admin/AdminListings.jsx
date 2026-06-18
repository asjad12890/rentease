import { useEffect, useState } from 'react';
import { ListPlus, Check, X, Eye, Building2, BedDouble } from 'lucide-react';
import Modal from '../../components/Modal';
import Spinner from '../../components/Spinner';
import { fmtDate } from '../../utils/format.jsx';

import { BASE_URL as BASE, getPhotoUrl } from '../../api/config';
const token = () => localStorage.getItem('token');
const authHdrs = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

const STATUS_STYLES = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};
const STATUS_LABELS = { pending: 'Pending Approval', approved: 'Live', rejected: 'Rejected' };

const CATEGORY_LABEL = { hostel: 'Hostel', apartment: 'Apartment', house: 'House' };

const TABS = ['all', 'pending', 'approved', 'rejected'];

export default function AdminListings() {
  const [tab, setTab] = useState('all');
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);

  // View modal + detail data
  const [viewModal, setViewModal] = useState(null);
  const [viewDetail, setViewDetail] = useState(null);
  const [viewDetailLoading, setViewDetailLoading] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // Reject modal
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  async function load(status) {
    setLoading(true);
    try {
      const params = status && status !== 'all' ? `?status=${status}` : '';
      const res = await fetch(`${BASE}/admin/listings${params}`, { headers: authHdrs() });
      if (res.ok) setListings(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(tab); }, [tab]);

  async function handleApprove(lid) {
    setActionId(lid);
    try {
      await fetch(`${BASE}/admin/listings/${lid}/approve`, { method: 'PUT', headers: authHdrs() });
      await load(tab);
      if (viewModal?.id === lid) setViewModal(null);
    } catch { /* ignore */ }
    finally { setActionId(null); }
  }

  async function handleReject() {
    if (!rejectReason.trim() || rejectReason.trim().length < 10) return;
    setRejecting(true);
    try {
      await fetch(`${BASE}/admin/listings/${rejectModal.id}/reject`, {
        method: 'PUT',
        headers: authHdrs(),
        body: JSON.stringify({ reason: rejectReason }),
      });
      setRejectModal(null);
      setRejectReason('');
      await load(tab);
      if (viewModal?.id === rejectModal?.id) setViewModal(null);
    } catch { /* ignore */ }
    finally { setRejecting(false); }
  }

  async function openView(listing) {
    setViewModal(listing);
    setViewDetail(null);
    setActivePhotoIdx(0);
    setViewDetailLoading(true);
    try {
      const res = await fetch(`${BASE}/admin/listings/${listing.id}`, { headers: authHdrs() });
      if (res.ok) {
        const d = await res.json();
        setViewDetail(d);
        setActivePhotoIdx(0);
      }
    } catch { /* ignore */ }
    finally { setViewDetailLoading(false); }
  }

  const counts = {
    all: listings.length,
    pending: listings.filter((l) => l.status === 'pending').length,
    approved: listings.filter((l) => l.status === 'approved').length,
    rejected: listings.filter((l) => l.status === 'rejected').length,
  };

  const detailPhotos = viewDetail?.photos || viewModal?.photos || [];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Listings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Review and approve property listings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition capitalize ${
              tab === t ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'all' ? 'All' : STATUS_LABELS[t]}
            {counts[t] > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                t === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                t === 'approved' ? 'bg-green-100 text-green-700' :
                t === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'
              }`}>{counts[t]}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-10 justify-center"><Spinner small /> Loading...</div>
      ) : listings.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <ListPlus size={56} className="mx-auto mb-4 text-gray-200" />
          <p className="text-lg font-semibold text-gray-500">
            No listings {tab !== 'all' ? `with status "${STATUS_LABELS[tab] || tab}"` : ''}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Photo', 'Property', 'Landlord', 'Title', 'Category', 'Submitted', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => {
                  const primaryPhoto = l.photos?.find((p) => p.is_primary) || l.photos?.[0];
                  return (
                    <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {primaryPhoto ? (
                          <img src={getPhotoUrl(primaryPhoto.photo_url)} alt=""
                            className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                            <Building2 size={16} className="text-gray-400" />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{l.property_name}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{l.landlord_name}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[160px]">
                        <p className="truncate">{l.title}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs capitalize">
                        {CATEGORY_LABEL[l.category] || l.category || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {fmtDate(l.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[l.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[l.status] || l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 items-center">
                          <button onClick={() => openView(l)} title="View"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition">
                            <Eye size={15} />
                          </button>
                          {l.status !== 'approved' && (
                            <button onClick={() => handleApprove(l.id)} disabled={actionId === l.id}
                              className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                              {actionId === l.id ? <Spinner small /> : null} Approve
                            </button>
                          )}
                          {l.status !== 'rejected' && (
                            <button onClick={() => { setRejectModal(l); setRejectReason(''); }}
                              className="px-3 py-1 border border-red-500 text-red-600 rounded text-xs hover:bg-red-50">
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── View Modal ───────────────────────────────────────────────────── */}
      {viewModal && (
        <Modal title={viewModal.title} onClose={() => setViewModal(null)}>
          <div className="space-y-4">
            {/* Photo gallery */}
            {detailPhotos.length > 0 ? (
              <div>
                <div className="w-full max-h-[300px] bg-gray-100 rounded-xl overflow-hidden mb-2">
                  <img src={getPhotoUrl(detailPhotos[activePhotoIdx]?.photo_url)} alt=""
                    className="w-full h-full object-cover max-h-[300px]" />
                </div>
                {detailPhotos.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {detailPhotos.map((p, i) => (
                      <button key={p.id} onClick={() => setActivePhotoIdx(i)}
                        className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition ${
                          activePhotoIdx === i ? 'border-blue-500' : 'border-transparent hover:border-gray-300'
                        }`}>
                        <img src={getPhotoUrl(p.photo_url)} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-40 bg-gray-100 rounded-xl flex items-center justify-center text-gray-300">
                <Building2 size={48} />
              </div>
            )}

            {/* Info */}
            <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 rounded-xl p-3">
              <div><p className="text-xs text-gray-400">Property</p><p className="font-medium">{viewModal.property_name}</p></div>
              <div><p className="text-xs text-gray-400">Category</p><p className="capitalize">{CATEGORY_LABEL[viewModal.category] || viewModal.category || '—'}</p></div>
              <div><p className="text-xs text-gray-400">Landlord</p><p className="font-medium">{viewModal.landlord_name}</p></div>
              <div>
                <p className="text-xs text-gray-400">Status</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[viewModal.status]}`}>
                  {STATUS_LABELS[viewModal.status]}
                </span>
              </div>
              {viewModal.address && (
                <div className="col-span-2"><p className="text-xs text-gray-400">Address</p><p>{viewModal.address}</p></div>
              )}
            </div>

            {viewModal.description && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-1">Description</p>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{viewModal.description}</p>
              </div>
            )}

            {/* Available Rooms */}
            {viewDetailLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-xs py-2"><Spinner small /> Loading rooms...</div>
            ) : viewDetail?.rooms !== undefined && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <BedDouble size={13} className="text-blue-500" /> Available Rooms
                </p>
                {viewDetail.rooms.length === 0 ? (
                  <p className="text-xs text-gray-400">No rooms available</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Room', 'Max Beds', 'Available', 'Price/Bed'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {viewDetail.rooms.map((r, i) => (
                          <tr key={i} className="border-t border-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-800">{r.room_number}</td>
                            <td className="px-3 py-2 text-gray-600">{r.max_beds}</td>
                            <td className="px-3 py-2">
                              <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">{r.available} free</span>
                            </td>
                            <td className="px-3 py-2 font-semibold text-blue-700">Rs {Number(r.price_per_bed).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              {viewModal.status !== 'approved' && (
                <button onClick={() => handleApprove(viewModal.id)} disabled={actionId === viewModal.id}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-60">
                  {actionId === viewModal.id ? <Spinner small /> : <Check size={14} />} Approve
                </button>
              )}
              {viewModal.status !== 'rejected' && (
                <button onClick={() => { setRejectModal(viewModal); setRejectReason(''); setViewModal(null); }}
                  className="px-4 py-2 border border-red-500 text-red-600 text-sm rounded-lg hover:bg-red-50 flex items-center gap-2">
                  <X size={14} /> Reject
                </button>
              )}
              <button onClick={() => setViewModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reject Modal ─────────────────────────────────────────────────── */}
      {rejectModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setRejectModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 text-base mb-1">Reject Listing</h3>
            <p className="text-sm text-gray-500 mb-4">{rejectModal.title}</p>
            <div className="mb-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Please provide a reason for rejection:</label>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                rows={3} placeholder="Minimum 10 characters..."
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none ${
                  rejectReason.trim().length > 0 && rejectReason.trim().length < 10 ? 'border-red-400' : 'border-gray-300'
                }`} />
              <div className="flex justify-between mt-1">
                {rejectReason.trim().length > 0 && rejectReason.trim().length < 10 && (
                  <p className="text-xs text-red-500">At least 10 characters required</p>
                )}
                <p className="text-xs text-gray-400 ml-auto">{rejectReason.length} chars</p>
              </div>
            </div>
            <div className="flex gap-3 mt-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleReject}
                disabled={rejecting || rejectReason.trim().length < 10}
                className="flex-1 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 flex items-center justify-center gap-2 disabled:opacity-60">
                {rejecting && <Spinner small />} Reject with Reason
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
