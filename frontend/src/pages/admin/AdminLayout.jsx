import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Building2, LayoutDashboard, Users, Building, UserCheck,
  DollarSign, Clock, Bell, LogOut, ChevronRight, User, KeyRound, X, ListPlus,
} from 'lucide-react';
import { fmtDateTime, timeAgo } from '../../utils/format.jsx';

const NAV = [
  { to: '/admin', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/admin/landlords', label: 'Landlords', Icon: Users },
  { to: '/admin/properties', label: 'Properties', Icon: Building },
  { to: '/admin/tenants', label: 'Tenants', Icon: UserCheck },
  { to: '/admin/listings', label: 'Listings', Icon: ListPlus },
  { to: '/admin/revenue', label: 'Revenue', Icon: DollarSign },
  { to: '/admin/history', label: 'History', Icon: Clock },
];

const PAGE_TITLES = {
  '/admin': 'Dashboard',
  '/admin/landlords': 'Landlords',
  '/admin/properties': 'Properties',
  '/admin/tenants': 'Tenants',
  '/admin/listings': 'Listings',
  '/admin/revenue': 'Revenue',
  '/admin/history': 'History',
};

const NOTIF_ICONS = {
  landlord_register: { Icon: Users, bg: 'bg-blue-100', color: 'text-blue-600' },
  property: { Icon: Building, bg: 'bg-indigo-100', color: 'text-indigo-600' },
  tenant: { Icon: UserCheck, bg: 'bg-green-100', color: 'text-green-600' },
  platform_fee: { Icon: DollarSign, bg: 'bg-purple-100', color: 'text-purple-600' },
  listing: { Icon: Clock, bg: 'bg-orange-100', color: 'text-orange-600' },
};
const DEFAULT_ADMIN_NOTIF = { Icon: Bell, bg: 'bg-gray-100', color: 'text-gray-500' };

const BASE = 'http://localhost:8000';
const token = () => localStorage.getItem('token');
const authHdrs = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

function AdminResetPasswordModal({ uid, name, notifId, onSuccess, onClose }) {
  const [form, setForm] = useState({ new_password: '', confirm_password: '' });
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
      const res = await fetch(`${BASE}/admin/users/${uid}/reset-password`, {
        method: 'PUT', headers: authHdrs(),
        body: JSON.stringify({ new_password: form.new_password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.detail || 'Failed to reset password'); return; }
      setMsg('Password reset successfully.');
      setTimeout(() => { onSuccess(notifId); onClose(); }, 1200);
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-gray-800">Reset Password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">for <span className="font-medium text-gray-700">{name}</span></p>
        {msg && <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{msg}</div>}
        {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{err}</div>}
        <form onSubmit={handleSubmit} className="space-y-3">
          {[['new_password', 'New Password'], ['confirm_password', 'Confirm Password']].map(([k, l]) => (
            <div key={k}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{l}</label>
              <input type="password" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required minLength={6} />
            </div>
          ))}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChangePasswordModal({ onClose }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    if (form.new_password !== form.confirm_password) { setErr('Passwords do not match.'); return; }
    if (form.new_password.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/admin/change-password`, {
        method: 'PUT', headers: authHdrs(),
        body: JSON.stringify({ current_password: form.current_password, new_password: form.new_password }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.detail || 'Failed'); return; }
      setMsg('Password changed successfully!');
      setForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch { setErr('Network error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-gray-800">Change Password</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        {msg && <div className="mb-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">{msg}</div>}
        {err && <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{err}</div>}
        <form onSubmit={handleSubmit} className="space-y-3">
          {[['current_password', 'Current Password'], ['new_password', 'New Password'], ['confirm_password', 'Confirm New']].map(([k, l]) => (
            <div key={k}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{l}</label>
              <input type="password" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
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

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [resetPwModal, setResetPwModal] = useState(null);
  const bellRef = useRef(null);
  const userRef = useRef(null);

  const pageTitle = Object.entries(PAGE_TITLES).find(([path]) =>
    path === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(path)
  )?.[1] || 'Admin';

  async function loadNotifications() {
    try {
      const [nRes, cRes] = await Promise.all([
        fetch(`${BASE}/admin/notifications`, { headers: authHdrs() }),
        fetch(`${BASE}/admin/notifications/unread-count`, { headers: authHdrs() }),
      ]);
      if (nRes.ok) setNotifications(await nRes.json());
      if (cRes.ok) setUnreadCount((await cRes.json()).count);
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
        await fetch(`${BASE}/admin/notifications/${n.id}/read`, { method: 'PUT', headers: authHdrs() });
        setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: 1 } : x));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch { /* ignore */ }
    }
    setBellOpen(false);
    if (n.link) navigate(n.link);
  }

  function handleResetSuccess(notifId) {
    setNotifications((prev) => prev.map((x) => x.id === notifId ? { ...x, is_read: 1 } : x));
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function handleMarkAllRead() {
    try {
      await fetch(`${BASE}/admin/notifications/read-all`, { method: 'PUT', headers: authHdrs() });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    } catch { /* ignore */ }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 bg-[#1e3a5f] flex flex-col flex-shrink-0">
        <div className="p-5 border-b border-white/10">
          <div className="text-white text-lg font-bold flex items-center gap-2">
            <Building2 size={22} className="text-blue-300" />
            <span>RentEase</span>
          </div>
          <p className="text-blue-300/70 text-xs mt-1">Super Admin Panel</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive ? 'bg-[#2563EB] text-white shadow' : 'text-blue-200 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <button onClick={() => { logout(); navigate('/login'); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-blue-200 hover:bg-white/10 hover:text-white transition">
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 h-14 flex-shrink-0 flex items-center justify-between px-6 shadow-sm relative z-40">
          <h2 className="text-base font-semibold text-gray-700">{pageTitle}</h2>
          <div className="flex items-center gap-2">
            {/* Bell */}
            <div ref={bellRef} className="relative">
              <button onClick={() => { setBellOpen((o) => !o); setUserOpen(false); }}
                className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition" title="Notifications">
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-full mt-1 w-[380px] bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <span className="font-semibold text-sm text-gray-800">Notifications</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{unreadCount > 0 ? `${unreadCount} unread` : 'All read'}</span>
                      {unreadCount > 0 && (
                        <button onClick={handleMarkAllRead} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Mark all read</button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-[440px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-8 text-center text-sm text-gray-400">No notifications yet</p>
                    ) : (
                      notifications.map((n) => {
                        if (n.type === 'password_reset') {
                          const name = n.message.split(' (')[0];
                          return (
                            <div key={n.id} className={`px-4 py-3 border-b border-gray-50 ${!n.is_read ? 'bg-orange-50/60' : 'bg-white'}`}>
                              <div className="flex gap-2.5 items-start">
                                <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center shrink-0 mt-0.5">
                                  <KeyRound size={13} className="text-orange-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-orange-600 mb-0.5">Password Reset Request</p>
                                  <p className={`text-xs leading-relaxed ${!n.is_read ? 'text-gray-800 font-medium' : 'text-gray-600'}`}>{n.message}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</p>
                                  {!n.is_read && n.user_id && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setBellOpen(false); setResetPwModal({ uid: n.user_id, name, notifId: n.id }); }}
                                      className="mt-2 px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded-lg font-medium transition">
                                      Reset Password
                                    </button>
                                  )}
                                </div>
                                {!n.is_read && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0 mt-1.5" />}
                              </div>
                            </div>
                          );
                        }
                        const { Icon: NIcon, bg, color } = NOTIF_ICONS[n.type] || DEFAULT_ADMIN_NOTIF;
                        return (
                          <button key={n.id} onClick={() => handleNotifClick(n)}
                            className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition ${!n.is_read ? 'bg-blue-50/50' : 'bg-white'}`}>
                            <div className="flex gap-2.5 items-start">
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
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                  <User size={14} className="text-blue-700" />
                </div>
                <span className="font-medium text-gray-700 hidden sm:block">Admin</span>
                <ChevronRight size={14} className="text-gray-400 rotate-90" />
              </button>
              {userOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-800">Super Admin</p>
                    <p className="text-xs text-gray-400">admin@rentease.com</p>
                  </div>
                  <button onClick={() => { setUserOpen(false); setShowChangePw(true); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-2">
                    <KeyRound size={14} className="text-gray-500" /> Change Password
                  </button>
                  <button onClick={() => { logout(); navigate('/login'); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition flex items-center gap-2 border-t border-gray-100">
                    <LogOut size={14} /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
      {resetPwModal && (
        <AdminResetPasswordModal
          uid={resetPwModal.uid}
          name={resetPwModal.name}
          notifId={resetPwModal.notifId}
          onSuccess={handleResetSuccess}
          onClose={() => setResetPwModal(null)}
        />
      )}
    </div>
  );
}
