import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Bell, AlertTriangle } from 'lucide-react';
import { fmtDate, toTitleCase } from '../../utils/format.jsx';

export default function TenantNotices() {
  const [notices, setNotices] = useState([]);

  async function load() {
    try {
      const res = await api.get('/my/notices');
      setNotices(res.data);
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); }, []);

  async function markRead(nid) {
    try {
      await api.put(`/my/notices/${nid}/read`);
      setNotices((prev) => prev.map((n) => n.id === nid ? { ...n, is_read: 1 } : n));
    } catch { /* ignore */ }
  }

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Notices</h1>
        {notices.filter((n) => !n.is_read).length > 0 && (
          <span className="text-xs text-gray-400">{notices.filter((n) => !n.is_read).length} unread</span>
        )}
      </div>

      {notices.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100 shadow-sm">
          <Bell size={48} className="mx-auto mb-4 text-gray-200" />
          <p className="text-gray-500 font-medium">No notices from your landlord yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => {
            const isUrgent = n.priority === 'urgent';
            const isUnread = !n.is_read;
            return (
              <div
                key={n.id}
                onClick={() => { if (isUnread) markRead(n.id); }}
                className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 cursor-pointer transition hover:shadow-md border-l-4 ${
                  isUrgent ? 'border-l-red-500' : isUnread ? 'border-l-blue-500' : 'border-l-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className={`font-semibold text-sm ${isUnread ? 'text-gray-800' : 'text-gray-600'}`}>
                        {toTitleCase(n.title)}
                      </h3>
                      {isUrgent && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                          <AlertTriangle size={10} /> Urgent
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-blue-600 mb-2">
                      {n.property_name ? `📍 ${n.property_name}` : '📍 All Properties'}
                    </p>
                    <p className={`text-sm ${isUnread ? 'text-gray-700' : 'text-gray-500'}`}>{n.message}</p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-400">
                        {n.created_at ? fmtDate(n.created_at) : ''}
                        {n.landlord_name ? ` · Posted by ${toTitleCase(n.landlord_name)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {isUnread && <span className="w-2.5 h-2.5 rounded-full bg-blue-500" title="Unread" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
