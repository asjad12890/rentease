import { useEffect, useState } from 'react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';
import { ChevronDown, ChevronUp, Search, MessageSquare } from 'lucide-react';
import { fmtDate, toTitleCase } from '../../utils/format.jsx';
import PhotoLightbox from '../../components/PhotoLightbox';

const STATUS_STYLES = {
  open: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
};

export default function Complaints() {
  const [complaints, setComplaints] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [responses, setResponses] = useState({});
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [lightbox, setLightbox] = useState(null);

  async function load() {
    const res = await api.get('/complaints');
    setComplaints(res.data);
  }

  useEffect(() => { load(); }, []);

  async function handleRespond(c) {
    setLoading(c.id);
    try {
      await api.put(`/complaints/${c.id}/respond`, {
        landlord_response: responses[c.id] || '',
        status: statuses[c.id] || 'in_progress',
      });
      await load();
    } finally {
      setLoading(null);
    }
  }

  const filtered = complaints.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.title?.toLowerCase().includes(q) || c.tenant_name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q);
    const matchStatus = !statusFilter || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Complaints</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {/* Search */}
      <div className="relative mb-5 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search complaints..."
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {complaints.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <MessageSquare size={56} className="mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-500">No complaints — all good!</p>
          <p className="text-sm mt-1">Tenant complaints will appear here</p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-12 text-sm text-gray-400">No complaints match your search.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <div key={c.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                className="w-full text-left p-5 hover:bg-gray-50 transition"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold text-gray-800">{c.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[c.status]}`}>
                        {toTitleCase(c.status.replace('_', ' '))}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs text-gray-400 flex-wrap">
                      <span>{c.tenant_name}</span>
                      {c.property_name && <span>{c.property_name}</span>}
                      {c.room_number && <span>{c.room_number}</span>}
                      <span>{fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                  <div className="ml-4 shrink-0">
                    {expanded === c.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>
              </button>
              {expanded === c.id && (
                <div className="border-t border-gray-100 p-5 bg-gray-50/50">
                  <p className="text-sm text-gray-700 mb-4 leading-relaxed">{c.description}</p>
                  {c.photo_url && (
                    <button onClick={() => setLightbox(`http://localhost:8000/uploads/${c.photo_url}`)} className="block mb-4">
                      <img
                        src={`http://localhost:8000/uploads/${c.photo_url}`}
                        alt="complaint photo"
                        className="w-28 h-28 object-cover rounded-xl border border-gray-200 hover:opacity-80 transition"
                      />
                    </button>
                  )}
                  {c.landlord_response && (
                    <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                      <p className="text-xs font-semibold text-blue-600 mb-1">Your previous response:</p>
                      <p className="text-sm text-gray-700">{c.landlord_response}</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    <textarea
                      value={responses[c.id] || ''}
                      onChange={(e) => setResponses({ ...responses, [c.id]: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      rows={3}
                      placeholder="Type your response..."
                    />
                    <div className="flex gap-3">
                      <select
                        value={statuses[c.id] || c.status}
                        onChange={(e) => setStatuses({ ...statuses, [c.id]: e.target.value })}
                        className={`border rounded-lg px-3 py-2 text-sm font-medium ${STATUS_STYLES[statuses[c.id] || c.status]}`}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                      <button
                        onClick={() => handleRespond(c)}
                        disabled={loading === c.id}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-60"
                      >
                        {loading === c.id && <Spinner small />}
                        Send Response
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
