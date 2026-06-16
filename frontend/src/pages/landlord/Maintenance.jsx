import { useEffect, useState } from 'react';
import api from '../../api/client';
import { ChevronDown, ChevronUp, Image, Wrench } from 'lucide-react';
import { fmtDate, toTitleCase } from '../../utils/format.jsx';
import PhotoLightbox from '../../components/PhotoLightbox';

const PRIORITY_STYLES = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const STATUS_STYLES = {
  open: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};

export default function Maintenance() {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [updating, setUpdating] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [notesMap, setNotesMap] = useState({}); // id → local notes text
  const [savingNotes, setSavingNotes] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  async function load() {
    const res = await api.get('/maintenance', { params: statusFilter ? { status_filter: statusFilter } : {} });
    setRequests(res.data);
    const initial = {};
    for (const r of res.data) { initial[r.id] = r.notes || ''; }
    setNotesMap((prev) => ({ ...initial, ...prev }));
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function updateStatus(id, status) {
    setUpdating(id);
    try {
      await api.put(`/maintenance/${id}/status`, { status });
      await load();
    } finally { setUpdating(null); }
  }

  async function saveNotes(id) {
    setSavingNotes(id);
    try {
      await api.put(`/maintenance/${id}/notes`, { notes: notesMap[id] || '' });
    } finally { setSavingNotes(null); }
  }

  const filtered = requests.filter((r) =>
    (!priorityFilter || r.priority === priorityFilter)
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Maintenance Requests</h1>
        <div className="flex gap-2">
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Wrench size={56} className="mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-500">No maintenance requests — all clear!</p>
          <p className="text-sm mt-1">Requests submitted by tenants will appear here</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No requests match the selected filters.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const isExpanded = expanded === r.id;
            return (
              <div key={r.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Card header */}
                <button className="w-full text-left p-5" onClick={() => setExpanded(isExpanded ? null : r.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-gray-800">{r.title}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLES[r.priority]}`}>
                          {toTitleCase(r.priority)}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                          {toTitleCase(r.status.replace('_', ' '))}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
                        <span>{r.tenant_name}</span>
                        <span>{r.room_number}</span>
                        <span>{fmtDate(r.created_at)}</span>
                        {r.resolved_at && <span className="text-green-600">Resolved {fmtDate(r.resolved_at)}</span>}
                      </div>
                      {!isExpanded && r.description && (
                        <p className="text-sm text-gray-500 mt-1.5 line-clamp-1">{r.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={r.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { e.stopPropagation(); updateStatus(r.id, e.target.value); }}
                        disabled={updating === r.id}
                        className={`border rounded-lg px-2.5 py-1.5 text-xs font-medium cursor-pointer ${STATUS_STYLES[r.status]} disabled:opacity-60`}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                      {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </div>
                  </div>
                </button>

                {/* Expanded section */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 p-5 space-y-4">
                    {r.description && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</p>
                        <p className="text-sm text-gray-700 leading-relaxed">{r.description}</p>
                      </div>
                    )}
                    {r.photo && (
                      <button
                        onClick={() => setLightbox(`http://localhost:8000/uploads/${r.photo}`)}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-xs font-medium hover:bg-blue-100 transition">
                        <Image size={14} /> View Photo
                      </button>
                    )}
                    <div>
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Internal Notes</label>
                      <textarea
                        value={notesMap[r.id] || ''}
                        onChange={(e) => setNotesMap((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                        rows={3}
                        placeholder="Add private notes about this request..."
                      />
                      <button
                        onClick={() => saveNotes(r.id)}
                        disabled={savingNotes === r.id}
                        className="mt-2 px-4 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-60"
                      >
                        {savingNotes === r.id ? 'Saving...' : 'Save Notes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
