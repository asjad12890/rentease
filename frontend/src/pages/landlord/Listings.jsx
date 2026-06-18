import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import Modal from '../../components/Modal';
import Spinner from '../../components/Spinner';
import { ListPlus, Trash2, Eye, Copy, Building, Plus, X, UploadCloud, Check } from 'lucide-react';
import { fmtDate, fmtDateTime, toTitleCase } from '../../utils/format.jsx';

import { getPhotoUrl } from '../../api/config';

const STATUS_STYLES = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};
const STATUS_LABELS = {
  pending:  'Pending Approval',
  approved: 'Live',
  rejected: 'Rejected',
};

function ConfirmModal({ title, message, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-800 text-base mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </div>
    </div>
  );
}

function PhotoUploadZone({ photos, previews, onSelect, onRemove, inputRef }) {
  const [dragging, setDragging] = useState(false);

  function handleFiles(files) {
    const remaining = 5 - photos.length;
    const toAdd = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, remaining);
    if (toAdd.length) onSelect(toAdd);
  }

  return (
    <div>
      {previews.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-3">
          {previews.map((url, i) => (
            <div key={i} className="relative group">
              <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
              {i === 0 && (
                <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] bg-blue-600 text-white rounded-b-lg py-0.5">Cover</span>
              )}
              <button onClick={() => onRemove(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {photos.length < 5 && (
        <>
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
            }`}
          >
            <UploadCloud size={32} className="mx-auto text-gray-400 mb-2" />
            <p className="text-sm font-medium text-gray-600">Click to upload or drag and drop</p>
            <p className="text-xs text-gray-400 mt-1">
              Up to 5 photos · First photo is cover image ({photos.length}/5 selected)
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function LandlordListings() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ property_id: '', title: '', description: '' });
  const [createPhotos, setCreatePhotos] = useState([]);
  const [createPreviews, setCreatePreviews] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createErrors, setCreateErrors] = useState({});
  const [createSuccess, setCreateSuccess] = useState('');
  const photoInputRef = useRef(null);

  // View modal
  const [viewModal, setViewModal] = useState(null);
  const [viewPhotos, setViewPhotos] = useState([]);
  const [addPhotoFiles, setAddPhotoFiles] = useState([]);
  const [addPhotoPreviews, setAddPhotoPreviews] = useState([]);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState(null);
  const addPhotoRef = useRef(null);

  // Inquiries modal
  const [inquiriesModal, setInquiriesModal] = useState(null);
  const [inquiries, setInquiries] = useState([]);
  const [inquiriesLoading, setInquiriesLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [togglingContact, setTogglingContact] = useState(null);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState(null);

  async function load() {
    try {
      const [lRes, pRes] = await Promise.all([
        api.get('/landlord/listings'),
        api.get('/properties'),
      ]);
      setListings(lRes.data);
      setProperties(pRes.data.filter((p) => p.status === 'approved'));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setCreateForm({ property_id: '', title: '', description: '' });
    setCreatePhotos([]);
    setCreatePreviews([]);
    setCreateErrors({});
    setCreateSuccess('');
    setShowCreate(true);
  }

  function handlePhotoSelect(files) {
    setCreatePhotos((prev) => [...prev, ...files]);
    setCreatePreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
  }

  function removeCreatePhoto(i) {
    setCreatePhotos((prev) => prev.filter((_, idx) => idx !== i));
    setCreatePreviews((prev) => {
      URL.revokeObjectURL(prev[i]);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  async function handleCreate() {
    const errors = {};
    if (!createForm.property_id) errors.property_id = 'Please select a property';
    if (!createForm.title.trim()) errors.title = 'Title is required';
    if (!createForm.description.trim()) errors.description = 'Description is required';
    if (Object.keys(errors).length) { setCreateErrors(errors); return; }
    setCreateErrors({});
    setCreating(true);
    try {
      const fd = new FormData();
      fd.append('property_id', createForm.property_id);
      fd.append('title', createForm.title);
      fd.append('description', createForm.description);
      createPhotos.forEach((f) => fd.append('photos', f));
      await api.post('/landlord/listings', fd);
      setCreateSuccess('Listing submitted for admin approval!');
      await load();
      setTimeout(() => { setShowCreate(false); setCreateSuccess(''); }, 2000);
    } catch (err) {
      setCreateErrors({ general: err.response?.data?.detail || 'Failed to create listing' });
    } finally { setCreating(false); }
  }

  async function handleDelete(lid) {
    try {
      await api.delete(`/landlord/listings/${lid}`);
      setConfirmDelete(null);
      await load();
    } catch { /* ignore */ }
  }

  async function openView(listing) {
    setViewModal(listing);
    setViewPhotos([]);
    setAddPhotoFiles([]);
    setAddPhotoPreviews([]);
    try {
      const res = await api.get(`/landlord/listings/${listing.id}/photos`);
      setViewPhotos(res.data);
    } catch { setViewPhotos([]); }
  }

  async function handleDeletePhoto(pid) {
    setDeletingPhotoId(pid);
    try {
      await api.delete(`/landlord/listings/photos/${pid}`);
      setViewPhotos((prev) => prev.filter((p) => p.id !== pid));
      await load();
    } catch { /* ignore */ }
    finally { setDeletingPhotoId(null); }
  }

  function handleAddPhotoSelect(files) {
    const slots = 5 - viewPhotos.length;
    const toAdd = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, slots);
    setAddPhotoFiles(toAdd);
    addPhotoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setAddPhotoPreviews(toAdd.map((f) => URL.createObjectURL(f)));
  }

  async function handleAddPhotos() {
    if (!addPhotoFiles.length) return;
    setAddingPhotos(true);
    try {
      const fd = new FormData();
      addPhotoFiles.forEach((f) => fd.append('photos', f));
      const res = await api.post(`/landlord/listings/${viewModal.id}/photos`, fd);
      setViewPhotos(res.data);
      setAddPhotoFiles([]);
      addPhotoPreviews.forEach((u) => URL.revokeObjectURL(u));
      setAddPhotoPreviews([]);
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to add photos');
    } finally { setAddingPhotos(false); }
  }

  async function openInquiries(listing) {
    setInquiriesModal(listing);
    setInquiries([]);
    setInquiriesLoading(true);
    try {
      const res = await api.get(`/landlord/listings/${listing.id}/inquiries`);
      setInquiries(res.data);
    } catch { setInquiries([]); }
    finally { setInquiriesLoading(false); }
  }

  function copyToClipboard(text, id, type) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId({ id, type });
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function toggleContacted(inq) {
    setTogglingContact(inq.id);
    try {
      const res = await api.put(`/landlord/listings/inquiries/${inq.id}/contact`);
      setInquiries((prev) => prev.map((i) => i.id === inq.id ? { ...i, contacted: res.data.contacted } : i));
    } catch { /* ignore */ }
    finally { setTogglingContact(null); }
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">My Listings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Public property listings — submit for admin approval</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
          <ListPlus size={16} /> Create Listing
        </button>
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <ListPlus size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No listings yet</p>
          <p className="text-gray-400 text-sm mt-1">Create your first listing to attract tenants</p>
          <button onClick={openCreate} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
            Create Listing
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Photo', 'Property', 'Title', 'Status', 'Inquiries', 'Created', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {l.primary_photo ? (
                        <img src={getPhotoUrl(l.primary_photo)} alt=""
                          className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                          <Building size={16} className="text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{l.property_name}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[180px]">
                      <p className="truncate">{l.title}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[l.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[l.status] || l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => openInquiries(l)}>
                        <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${
                          l.inquiries_count > 0
                            ? 'bg-blue-50 text-blue-600 border-blue-200'
                            : 'bg-gray-50 text-gray-400 border-gray-200'
                        }`}>
                          {l.inquiries_count || 0} {l.inquiries_count === 1 ? 'inquiry' : 'inquiries'}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {fmtDate(l.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button onClick={() => openView(l)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="View / Manage Photos">
                          <Eye size={15} />
                        </button>
                        <button onClick={() => setConfirmDelete(l.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Create Listing Modal ─────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="Create Listing" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            {createErrors.general && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{createErrors.general}</div>
            )}
            {createSuccess && (
              <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{createSuccess}</div>
            )}

            {/* 1. Property */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Property *</label>
              <select
                value={createForm.property_id}
                onChange={(e) => { setCreateForm({ ...createForm, property_id: e.target.value }); setCreateErrors((p) => ({ ...p, property_id: '' })); }}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${createErrors.property_id ? 'border-red-400' : 'border-gray-300'}`}
              >
                <option value="">Select a property...</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.address || p.city || ''}</option>
                ))}
              </select>
              {createErrors.property_id && <p className="text-red-500 text-xs mt-1">{createErrors.property_id}</p>}
            </div>

            {/* 2. Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                type="text"
                value={createForm.title}
                onChange={(e) => { setCreateForm({ ...createForm, title: e.target.value }); setCreateErrors((p) => ({ ...p, title: '' })); }}
                placeholder="e.g. Spacious Hostel Room Near FAST"
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${createErrors.title ? 'border-red-400' : 'border-gray-300'}`}
              />
              {createErrors.title && <p className="text-red-500 text-xs mt-1">{createErrors.title}</p>}
            </div>

            {/* 3. Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
              <textarea
                value={createForm.description}
                onChange={(e) => { setCreateForm({ ...createForm, description: e.target.value }); setCreateErrors((p) => ({ ...p, description: '' })); }}
                rows={4}
                placeholder="Describe the property, nearby landmarks, amenities, rules..."
                style={{ minHeight: '100px' }}
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none ${createErrors.description ? 'border-red-400' : 'border-gray-300'}`}
              />
              {createErrors.description && <p className="text-red-500 text-xs mt-1">{createErrors.description}</p>}
            </div>

            {/* 4. Photos */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Photos <span className="text-gray-400 font-normal">(up to 5, first = cover)</span>
              </label>
              <PhotoUploadZone
                photos={createPhotos}
                previews={createPreviews}
                onSelect={handlePhotoSelect}
                onRemove={removeCreatePhoto}
                inputRef={photoInputRef}
              />
            </div>

            <div className="flex gap-3 justify-end pt-1">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleCreate} disabled={creating}
                className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {creating && <Spinner small />} Submit Listing
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── View / Photo Management Modal ───────────────────────────────── */}
      {viewModal && (
        <Modal title={viewModal.title} onClose={() => setViewModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm bg-gray-50 rounded-xl p-3">
              <div><p className="text-xs text-gray-400">Property</p><p className="font-medium">{viewModal.property_name}</p></div>
              <div>
                <p className="text-xs text-gray-400">Status</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[viewModal.status]}`}>
                  {STATUS_LABELS[viewModal.status]}
                </span>
              </div>
            </div>

            {viewModal.description && (
              <p className="text-sm text-gray-600 leading-relaxed">{viewModal.description}</p>
            )}

            {/* Photos */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Photos ({viewPhotos.length}/5)
              </p>
              {viewPhotos.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-3">
                  {viewPhotos.map((p) => (
                    <div key={p.id} className="relative group">
                      <img src={getPhotoUrl(p.photo_url)} alt=""
                        className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                      {p.is_primary === 1 && (
                        <span className="absolute bottom-0 left-0 right-0 text-center text-[9px] bg-blue-600 text-white rounded-b-lg py-0.5">Cover</span>
                      )}
                      <button onClick={() => handleDeletePhoto(p.id)}
                        disabled={deletingPhotoId === p.id}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow">
                        {deletingPhotoId === p.id ? <Spinner small /> : <X size={10} />}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {viewPhotos.length < 5 && (
                <div>
                  {addPhotoPreviews.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-2">
                      {addPhotoPreviews.map((url, i) => (
                        <img key={i} src={url} alt="" className="w-16 h-16 object-cover rounded-lg border border-blue-300" />
                      ))}
                    </div>
                  )}
                  <input ref={addPhotoRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => { handleAddPhotoSelect(e.target.files); e.target.value = ''; }} />
                  <div
                    onClick={() => addPhotoRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleAddPhotoSelect(e.dataTransfer.files); }}
                    className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
                  >
                    <UploadCloud size={24} className="mx-auto text-gray-400 mb-1" />
                    <p className="text-xs font-medium text-gray-600">Click to upload or drag and drop</p>
                    <p className="text-xs text-gray-400 mt-0.5">Up to 5 photos · First photo is cover image</p>
                  </div>
                  {addPhotoFiles.length > 0 && (
                    <button onClick={handleAddPhotos} disabled={addingPhotos}
                      className="mt-2 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 flex items-center gap-1 disabled:opacity-60">
                      {addingPhotos && <Spinner small />} Upload {addPhotoFiles.length} Photo{addPhotoFiles.length > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button onClick={() => setViewModal(null)} className="px-4 py-2 text-sm text-gray-600">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Inquiries Modal ──────────────────────────────────────────────── */}
      {inquiriesModal && (
        <Modal title={`Inquiries — ${inquiriesModal.title}`} onClose={() => setInquiriesModal(null)}>
          <div>
            {inquiriesLoading ? (
              <div className="flex items-center gap-2 text-gray-400 py-6 justify-center"><Spinner small /> Loading...</div>
            ) : inquiries.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No inquiries yet.</p>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {inquiries.map((inq) => (
                  <div key={inq.id} className={`rounded-xl p-4 text-sm border ${inq.contacted ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-semibold text-gray-800">{toTitleCase(inq.name)}</p>
                      <span className="text-xs text-gray-400 shrink-0">{fmtDateTime(inq.created_at)}</span>
                    </div>

                    <div className="space-y-1 mb-3">
                      <div className="flex items-center gap-2 text-xs">
                        <a href={`mailto:${inq.email}`} className="text-blue-600 hover:underline">{inq.email}</a>
                        <button onClick={() => copyToClipboard(inq.email, inq.id, 'email')}
                          className="text-gray-400 hover:text-blue-600 transition" title="Copy email">
                          {copiedId?.id === inq.id && copiedId?.type === 'email'
                            ? <span className="text-green-600 text-[10px] font-medium">Copied!</span>
                            : <Copy size={10} />}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <a href={`tel:${inq.phone}`} className="text-blue-600 hover:underline">{inq.phone}</a>
                        <button onClick={() => copyToClipboard(inq.phone, inq.id, 'phone')}
                          className="text-gray-400 hover:text-blue-600 transition" title="Copy phone">
                          {copiedId?.id === inq.id && copiedId?.type === 'phone'
                            ? <span className="text-green-600 text-[10px] font-medium">Copied!</span>
                            : <Copy size={10} />}
                        </button>
                      </div>
                    </div>

                    {inq.message
                      ? <p className="text-xs text-gray-500 italic mb-3">"{inq.message}"</p>
                      : <p className="text-xs text-gray-400 italic mb-3">No message provided</p>
                    }

                    <button
                      onClick={() => toggleContacted(inq)}
                      disabled={togglingContact === inq.id}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition ${
                        inq.contacted
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {togglingContact === inq.id
                        ? <Spinner small />
                        : inq.contacted ? <Check size={12} /> : null}
                      {inq.contacted ? 'Contacted ✓' : 'Mark as Contacted'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setInquiriesModal(null)} className="px-4 py-2 text-sm text-gray-600">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm ───────────────────────────────────────────────── */}
      {confirmDelete && (
        <ConfirmModal
          title="Delete Listing"
          message="This will permanently delete the listing, all photos, and all inquiries. This cannot be undone."
          onConfirm={() => handleDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
