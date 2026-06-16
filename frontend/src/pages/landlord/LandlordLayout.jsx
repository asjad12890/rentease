import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import { fmtDateTime, timeAgo } from '../../utils/format';
import {
  Building2, LayoutDashboard, Building, Users, Wrench, MessageSquare,
  Bell, BarChart2, CreditCard, ChevronDown, KeyRound, LogOut, ListPlus,
  DollarSign, Info,
} from 'lucide-react';

const NAV = [
  { to: '/landlord',             label: 'Overview',       Icon: LayoutDashboard, end: true },
  { to: '/landlord/properties',  label: 'Properties',     Icon: Building },
  { to: '/landlord/tenants',     label: 'Tenants & Rent', Icon: Users },
  { to: '/landlord/listings',    label: 'Listings',       Icon: ListPlus },
  { to: '/landlord/maintenance', label: 'Maintenance',    Icon: Wrench },
  { to: '/landlord/complaints',  label: 'Complaints',     Icon: MessageSquare },
  { to: '/landlord/notices',     label: 'Notices',        Icon: Bell },
  { to: '/landlord/reports',     label: 'Reports',        Icon: BarChart2 },
];

const NOTIF_ICON_MAP = {
  payment: { Icon: CreditCard, bg: 'bg-green-100', color: 'text-green-600' },
  maintenance: { Icon: Wrench, bg: 'bg-orange-100', color: 'text-orange-600' },
  complaint: { Icon: MessageSquare, bg: 'bg-red-100', color: 'text-red-600' },
  platform_fee: { Icon: DollarSign, bg: 'bg-purple-100', color: 'text-purple-600' },
  listing: { Icon: Building2, bg: 'bg-blue-100', color: 'text-blue-600' },
  inquiry: { Icon: Info, bg: 'bg-indigo-100', color: 'text-indigo-600' },
};
const DEFAULT_NOTIF = { Icon: Bell, bg: 'bg-gray-100', color: 'text-gray-500' };

function truncateName(name) {
  if (!name) return 'Landlord';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    if (form.new_password !== form.confirm_password) { setErr('Passwords do not match.'); return; }
    if (form.new_password.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      const res = await api.put('/landlord/change-password', {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      setMsg(res.data.message || 'Password changed successfully.');
      setForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setErr(err.response?.data?.detail || 'Failed to change password.');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg text-gray-800 mb-4">Change Password</h2>
        {msg && <div className="mb-3 p-2 bg-green-50 text-green-700 rounded text-sm">{msg}</div>}
        {err && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{err}</div>}
        <form onSubmit={handleSubmit} className="space-y-3">
          {[['current_password','Current Password'],['new_password','New Password'],['confirm_password','Confirm New']].map(([k,l]) => (
            <div key={k}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{l}</label>
              <input type="password" value={form[k]} onChange={(e) => setForm({...form,[k]:e.target.value})}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required />
            </div>
          ))}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Saving...' : 'Change'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LandlordLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const bellRef = useRef(null);
  const userRef = useRef(null);

  async function loadNotifications() {
    try {
      const [nRes, cRes] = await Promise.all([
        api.get('/notifications'),
        api.get('/notifications/unread-count'),
      ]);
      setNotifications(nRes.data);
      setUnreadCount(cRes.data.count);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadNotifications();
    const iv = setInterval(loadNotifications, 30_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    function handler(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleNotifClick(n) {
    if (!n.is_read) {
      try {
        await api.put(`/notifications/${n.id}/read`);
        setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: 1 } : x));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch { /* ignore */ }
    }
    setBellOpen(false);
    if (n.link) navigate(n.link);
  }

  async function handleMarkAllRead() {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await api.put('/notifications/read-all');
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    } finally { setMarkingAll(false); }
  }

  return (
    <div className="flex h-screen bg-gray-50">

      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col shadow-sm flex-shrink-0">
        <div className="p-4 border-b border-gray-100">
          <div className="text-blue-700 text-base font-bold flex items-center gap-1.5">
            <Building2 size={18} className="text-blue-600" /> <span>RentEase</span>
          </div>
          <p className="text-gray-400 text-xs mt-0.5">Landlord Dashboard</p>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Right panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="bg-white border-b border-gray-200 h-12 flex-shrink-0 flex items-center justify-end px-4 gap-3 shadow-sm relative z-40">
          {/* Notification bell */}
          <div ref={bellRef} className="relative">
            <button onClick={() => { setBellOpen((o) => !o); setUserOpen(false); }}
              className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition"
              title="Notifications">
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 top-full mt-1 w-[400px] bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <span className="font-semibold text-sm text-gray-800">Notifications</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{unreadCount > 0 ? `${unreadCount} unread` : 'All read'}</span>
                    {unreadCount > 0 && (
                      <button onClick={handleMarkAllRead} disabled={markingAll}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50">
                        {markingAll ? 'Marking...' : 'Mark all read'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-[480px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-gray-400">No notifications yet</p>
                  ) : (
                    notifications.map((n) => {
                      const { Icon: NIcon, bg, color } = NOTIF_ICON_MAP[n.type] || DEFAULT_NOTIF;
                      return (
                        <button key={n.id} onClick={() => handleNotifClick(n)}
                          className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition ${!n.is_read ? 'bg-blue-50/60' : 'bg-white'}`}>
                          <div className="flex gap-3 items-start">
                            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                              <NIcon size={14} className={color} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs leading-relaxed ${!n.is_read ? 'text-gray-800 font-medium' : 'text-gray-600'}`}>{n.message}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</p>
                            </div>
                            {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User dropdown */}
          <div ref={userRef} className="relative">
            <button onClick={() => { setUserOpen((o) => !o); setBellOpen(false); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition text-sm">
              <span className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold text-xs">
                {(user?.name || 'L').charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[120px] truncate">{truncateName(user?.name)}</span>
              <ChevronDown size={14} className="text-gray-400" />
            </button>

            {userOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800 truncate">{user?.name || 'Landlord'}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email || ''}</p>
                </div>
                <button onClick={() => { setUserOpen(false); setShowChangePw(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2">
                  <KeyRound size={14} className="text-gray-400" /> Change Password
                </button>
                <button onClick={() => { logout(); navigate('/login'); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition flex items-center gap-2 border-t border-gray-100">
                  <LogOut size={14} /> Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet context={{ reloadNotifications: loadNotifications }} />
        </main>
      </div>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  );
}
