import { useState } from 'react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';

export default function Settings() {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function handleChange(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    if (!form.current_password || !form.new_password) { setErr('All fields are required.'); return; }
    if (form.new_password !== form.confirm_password) { setErr('New passwords do not match.'); return; }
    if (form.new_password.length < 6) { setErr('New password must be at least 6 characters.'); return; }
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Settings</h1>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Change Password</h2>
        {msg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{msg}</div>}
        {err && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{err}</div>}
        <form onSubmit={handleChange} className="space-y-4">
          {[
            ['current_password', 'Current Password'],
            ['new_password', 'New Password'],
            ['confirm_password', 'Confirm New Password'],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                type="password"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          ))}
          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
            {saving && <Spinner small />}Change Password
          </button>
        </form>
      </div>
    </div>
  );
}
