import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import { MessageSquare, UploadCloud, X, Image } from 'lucide-react';
import { fmtDate, toTitleCase } from '../../utils/format.jsx';
import PhotoLightbox from '../../components/PhotoLightbox';

const BASE = 'http://localhost:8000';
const MAX_DESC = 500;

const PRIORITY_CFG = {
  low:    { label: 'Low',    active: 'bg-green-600 text-white',  },
  medium: { label: 'Medium', active: 'bg-yellow-500 text-white', },
  high:   { label: 'High',   active: 'bg-orange-500 text-white', },
  urgent: { label: 'Urgent', active: 'bg-red-600 text-white',    },
};

const PRIORITY_BADGE = {
  low:    'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-800',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const STATUS_STYLES = {
  open:        'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved:    'bg-green-100 text-green-700',
};

const STATUS_LABELS = {
  open:        'Open',
  in_progress: 'In Progress',
  resolved:    'Resolved',
};

function ExpandableText({ text, max = 150 }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span className="text-gray-400 italic text-sm">No description provided.</span>;
  if (text.length <= max) return <p className="text-sm text-gray-600">{text}</p>;
  return (
    <p className="text-sm text-gray-600">
      {expanded ? text : text.slice(0, max) + '…'}
      <button onClick={() => setExpanded((e) => !e)}
        className="ml-1 text-blue-600 hover:text-blue-800 text-xs font-medium">
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </p>
  );
}

export default function TenantComplaints() {
  const [complaints, setComplaints] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium' });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef();

  async function load() {
    try {
      const res = await api.get('/my/complaints');
      setComplaints(res.data);
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit() {
    setError('');
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('description', form.description || '');
      fd.append('priority', form.priority);
      if (photo) fd.append('photo', photo);
      await api.post('/my/complaints', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setForm({ title: '', description: '', priority: 'medium' });
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Complaints</h1>

      {/* Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 max-w-2xl">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Submit a Complaint</h2>
        {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Noise from neighbors" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <div className="flex gap-2">
              {Object.entries(PRIORITY_CFG).map(([val, cfg]) => (
                <button key={val} type="button" onClick={() => setForm({ ...form, priority: val })}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition ${
                    form.priority === val ? cfg.active + ' border-transparent' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, MAX_DESC) })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4} placeholder="Describe your complaint..." />
            <p className="text-xs text-gray-400 mt-1 text-right">{form.description.length} / {MAX_DESC} characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Attach a photo <span className="text-gray-400 font-normal">(optional)</span></label>
            {photo ? (
              <div className="flex items-center justify-between p-3 border border-gray-200 rounded-xl bg-gray-50">
                <span className="text-sm text-gray-700 truncate">{photo.name}</span>
                <button onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="ml-2 text-gray-400 hover:text-red-500"><X size={14} /></button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full border-2 border-dashed border-gray-300 rounded-xl p-5 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition">
                <UploadCloud size={28} className="text-gray-300 mb-2" />
                <span className="text-sm text-gray-500">Click to upload a photo</span>
                <span className="text-xs text-gray-400 mt-1">JPG or PNG up to 5MB</span>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files[0])} />
              </label>
            )}
          </div>
        </div>

        <button onClick={handleSubmit} disabled={loading || !form.title.trim()}
          className="mt-5 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60 transition">
          {loading && <Spinner small />}
          Submit Complaint
        </button>
      </div>

      {/* Complaint list */}
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-4">My Complaints</h2>
        {complaints.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm">
            <MessageSquare size={44} className="mx-auto mb-3 text-gray-200" />
            <p className="text-gray-500 font-medium">No complaints submitted yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {complaints.map((c) => (
              <div key={c.id} className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-orange-400 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-gray-800 text-sm">{c.title}</h3>
                      {c.priority && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[c.priority] || 'bg-gray-100 text-gray-600'}`}>
                          {toTitleCase(c.priority)}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABELS[c.status] || toTitleCase(c.status)}
                      </span>
                    </div>
                    <ExpandableText text={c.description} />
                    <p className="text-xs text-gray-400 mt-1">Submitted: {fmtDate(c.created_at)}</p>
                  </div>
                  {c.photo_url && (
                    <button onClick={() => setLightbox(c.photo_url)}
                      className="shrink-0 px-3 py-1.5 border border-blue-400 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-50 flex items-center gap-1.5 transition">
                      <Image size={11} /> View Photo
                    </button>
                  )}
                </div>

                {/* Landlord response */}
                <div className="mt-3">
                  {c.landlord_response ? (
                    <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Landlord Response</p>
                      <p className="text-sm text-gray-700">{c.landlord_response}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Awaiting landlord response…</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
