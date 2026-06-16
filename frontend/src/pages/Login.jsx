import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { Building2, Eye, EyeOff, ChevronLeft } from 'lucide-react';

const PHONE_RE = /^03\d{2}-\d{7}$/;
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  const [tab, setTab] = useState(searchParams.get('tab') === 'register' ? 'register' : 'login');
  const [visible, setVisible] = useState(false);

  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [regForm, setRegForm] = useState({ name: '', email: '', password: '', business_name: '', phone: '', cnic: '' });
  const [regErrors, setRegErrors] = useState({});
  const [regSuccess, setRegSuccess] = useState(false);

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');

  useEffect(() => { setTimeout(() => setVisible(true), 10); }, []);

  async function handleForgotSubmit(e) {
    e.preventDefault();
    setForgotLoading(true);
    try {
      const res = await api.post('/auth/forgot-password', { email: forgotEmail });
      setForgotMsg(res.data.message);
    } catch {
      setForgotMsg('If your email is registered, an admin will be notified to reset your password.');
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', form);
      const payload = login(res.data.token, res.data);
      if (payload.role === 'superadmin') navigate('/admin');
      else if (payload.role === 'landlord') navigate('/landlord');
      else navigate('/tenant');
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function validateReg() {
    const errs = {};
    if (!regForm.name.trim()) errs.name = 'Full name is required.';
    if (!regForm.email.trim()) errs.email = 'Email is required.';
    if (regForm.password.length < 6) errs.password = 'Password must be at least 6 characters.';
    if (!regForm.business_name.trim()) errs.business_name = 'Business name is required.';
    if (!PHONE_RE.test(regForm.phone)) errs.phone = 'Format: 03XX-XXXXXXX (e.g. 0300-1234567)';
    if (!CNIC_RE.test(regForm.cnic)) errs.cnic = 'Format: XXXXX-XXXXXXX-X (e.g. 35201-1234567-1)';
    return errs;
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    const errs = validateReg();
    if (Object.keys(errs).length > 0) { setRegErrors(errs); return; }
    setRegErrors({});
    setLoading(true);
    try {
      await api.post('/auth/register', regForm);
      setRegSuccess(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  function switchTab(t) {
    setTab(t);
    setError('');
    setRegErrors({});
    setRegSuccess(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-800 to-violet-700 flex flex-col">
      {/* Back to landing */}
      <button
        onClick={() => navigate('/')}
        className="absolute top-4 left-6 flex items-center gap-1 text-white/70 hover:text-white text-sm transition-colors"
      >
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className={`w-full max-w-md transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <Building2 size={22} className="text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white">RentEase</h1>
            </div>
            <p className="text-white/80 text-sm mt-1">Smart Property Management for Everyone</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {/* Tabs */}
            <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
              <button
                onClick={() => switchTab('login')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${tab === 'login' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Sign In
              </button>
              <button
                onClick={() => switchTab('register')}
                className={`flex-1 py-2 rounded-md text-sm font-medium transition ${tab === 'register' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Register as Landlord
              </button>
            </div>

            {/* LOGIN TAB */}
            {tab === 'login' && (
              <>
                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                  </div>
                )}
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        required
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                        tabIndex={-1}
                      >
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div className="flex justify-end mt-1">
                      <button
                        type="button"
                        onClick={() => { setShowForgot(true); setForgotMsg(''); setForgotEmail(''); }}
                        className="text-xs text-gray-400 hover:text-blue-600 transition"
                      >
                        Forgot Password?
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 hover:brightness-110 text-white font-medium py-2.5 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 mt-2"
                  >
                    {loading && <Spinner small />}
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              </>
            )}

            {/* REGISTER TAB */}
            {tab === 'register' && (
              <>
                {regSuccess ? (
                  <div className="text-center py-6">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                      <Building2 size={28} className="text-green-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">Account created!</h3>
                    <p className="text-sm text-gray-600">
                      You can now sign in with your credentials.
                    </p>
                    <button
                      onClick={() => switchTab('login')}
                      className="mt-6 text-sm text-blue-600 hover:text-blue-800 underline"
                    >
                      Sign In
                    </button>
                  </div>
                ) : (
                  <>
                    {error && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        {error}
                      </div>
                    )}
                    <form onSubmit={handleRegister} className="space-y-3">
                      {/* Full Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                        <input
                          type="text"
                          required
                          value={regForm.name}
                          onChange={(e) => setRegForm({ ...regForm, name: e.target.value })}
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${regErrors.name ? 'border-red-400' : 'border-gray-300'}`}
                          placeholder="Your Name"
                        />
                        {regErrors.name && <p className="text-xs text-red-500 mt-0.5">{regErrors.name}</p>}
                      </div>

                      {/* Email */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                        <input
                          type="email"
                          required
                          value={regForm.email}
                          onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${regErrors.email ? 'border-red-400' : 'border-gray-300'}`}
                          placeholder="you@example.com"
                        />
                        {regErrors.email && <p className="text-xs text-red-500 mt-0.5">{regErrors.email}</p>}
                      </div>

                      {/* Password */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                        <input
                          type="password"
                          required
                          value={regForm.password}
                          onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${regErrors.password ? 'border-red-400' : 'border-gray-300'}`}
                          placeholder="••••••••"
                        />
                        {regErrors.password && <p className="text-xs text-red-500 mt-0.5">{regErrors.password}</p>}
                      </div>

                      {/* Business Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label>
                        <input
                          type="text"
                          required
                          value={regForm.business_name}
                          onChange={(e) => setRegForm({ ...regForm, business_name: e.target.value })}
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${regErrors.business_name ? 'border-red-400' : 'border-gray-300'}`}
                          placeholder="My Hostels"
                        />
                        {regErrors.business_name && <p className="text-xs text-red-500 mt-0.5">{regErrors.business_name}</p>}
                      </div>

                      {/* Phone */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                        <input
                          type="text"
                          required
                          value={regForm.phone}
                          onChange={(e) => setRegForm({ ...regForm, phone: e.target.value })}
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${regErrors.phone ? 'border-red-400' : 'border-gray-300'}`}
                          placeholder="03XX-XXXXXXX"
                        />
                        {regErrors.phone
                          ? <p className="text-xs text-red-500 mt-0.5">{regErrors.phone}</p>
                          : <p className="text-xs text-gray-400 mt-0.5">Format: 03XX-XXXXXXX</p>}
                      </div>

                      {/* CNIC */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">CNIC *</label>
                        <input
                          type="text"
                          required
                          value={regForm.cnic}
                          onChange={(e) => setRegForm({ ...regForm, cnic: e.target.value })}
                          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${regErrors.cnic ? 'border-red-400' : 'border-gray-300'}`}
                          placeholder="XXXXX-XXXXXXX-X"
                        />
                        {regErrors.cnic
                          ? <p className="text-xs text-red-500 mt-0.5">{regErrors.cnic}</p>
                          : <p className="text-xs text-gray-400 mt-0.5">Format: XXXXX-XXXXXXX-X</p>}
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:brightness-110 text-white font-medium py-2.5 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-60 mt-2"
                      >
                        {loading && <Spinner small />}
                        {loading ? 'Submitting...' : 'Register'}
                      </button>
                    </form>

                    <p className="text-xs text-gray-400 text-center mt-4">
                      Are you a tenant? Your landlord will create your account and share your login details with you.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-white/60 text-xs py-4">
        © 2026 RentEase. All rights reserved.
      </p>

      {/* Forgot Password Modal */}
      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowForgot(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg text-gray-800 mb-1">Forgot Password?</h2>
            <p className="text-sm text-gray-500 mb-4">Enter your email and an admin will be notified to reset your password.</p>
            {forgotMsg ? (
              <>
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 mb-4">{forgotMsg}</div>
                <button onClick={() => setShowForgot(false)}
                  className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
                  Close
                </button>
              </>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-3">
                <input type="email" required value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  placeholder="you@example.com" />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowForgot(false)}
                    className="flex-1 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                    Cancel
                  </button>
                  <button type="submit" disabled={forgotLoading}
                    className="flex-1 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2 transition">
                    {forgotLoading && <Spinner small />}
                    {forgotLoading ? 'Sending...' : 'Send Request'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
