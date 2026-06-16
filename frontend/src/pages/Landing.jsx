import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Building2, DollarSign, Users, ChevronDown } from 'lucide-react';

const FEATURES = [
  {
    Icon: Building2,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    title: 'Manage Properties',
    desc: 'Add hostels, apartments, and houses. Track rooms, beds, and occupancy rates in real time.',
  },
  {
    Icon: DollarSign,
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
    title: 'Track Rent Payments',
    desc: 'Generate rent, accept payments, and keep complete payment history for every tenant automatically.',
  },
  {
    Icon: Users,
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
    title: 'Tenant Self-Service',
    desc: 'Tenants can pay rent, submit maintenance requests, and view notices from their own portal.',
  },
];

const STATS = [
  { value: '3 Portals', label: 'Admin, Landlord, Tenant' },
  { value: '100% Online', label: 'Manage from anywhere' },
  { value: 'Real-time Updates', label: 'Instant notifications' },
];

export default function Landing() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [fading, setFading] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 10);
  }, []);

  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'superadmin') navigate('/admin', { replace: true });
      else if (user.role === 'landlord') navigate('/landlord', { replace: true });
      else navigate('/tenant', { replace: true });
    }
  }, [user, loading, navigate]);

  function goTo(path) {
    setFading(true);
    setTimeout(() => navigate(path), 280);
  }

  if (loading) return null;

  return (
    <div className={`transition-opacity duration-300 ${fading ? 'opacity-0' : visible ? 'opacity-100' : 'opacity-0'}`}>
      {/* HERO */}
      <section
        className="bg-gradient-to-br from-blue-900 via-indigo-800 to-violet-700 flex flex-col items-center justify-center px-4 relative"
        style={{ minHeight: 'calc(100vh - 180px)' }}
      >
        {/* Content */}
        <div className="text-center max-w-2xl">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg">
              <Building2 size={30} className="text-white" />
            </div>
            <h1 className="text-5xl font-bold text-white tracking-tight">RentEase</h1>
          </div>

          {/* Tagline */}
          <p className="text-white/90 text-2xl font-medium mt-4">
            Smart Property Management for Everyone
          </p>

          {/* Description */}
          <p className="text-white/75 text-lg mt-3 max-w-lg mx-auto leading-relaxed">
            Manage your properties, track rent payments, and keep your tenants happy — all in one place.
          </p>

          {/* CTA Buttons */}
          <div className="flex items-center justify-center gap-4 mt-10 flex-wrap">
            <button
              onClick={() => goTo('/login')}
              className="px-8 py-3 bg-white text-blue-700 font-semibold rounded-xl hover:bg-blue-50 transition shadow-lg"
            >
              Sign In
            </button>
            <button
              onClick={() => goTo('/login?tab=register')}
              className="px-8 py-3 border-2 border-white text-white font-semibold rounded-xl hover:bg-white/10 transition"
            >
              Get Started
            </button>
            <button
              onClick={() => goTo('/listings')}
              className="px-6 py-2.5 border border-white/60 text-white/80 font-medium rounded-xl hover:bg-white/10 transition text-sm"
            >
              Browse Properties
            </button>
          </div>
        </div>

        {/* Scroll indicator — sits at bottom of hero, just above the peeking features */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 animate-bounce">
          <ChevronDown size={28} />
        </div>
      </section>

      {/* FEATURES */}
      <section className="bg-white py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-800 text-center mb-12">
            Everything you need to manage your property
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {FEATURES.map(({ Icon, iconBg, iconColor, title, desc }) => (
              <div
                key={title}
                className="bg-white rounded-2xl shadow-md border border-gray-100 p-8 hover:shadow-lg transition-shadow duration-200"
              >
                <div className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center mb-5`}>
                  <Icon size={24} className={iconColor} />
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="bg-gray-50 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {STATS.map(({ value, label }) => (
              <div key={value} className="py-6">
                <p className="text-3xl font-bold text-gray-800 mb-1">{value}</p>
                <p className="text-gray-500 text-sm">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-white border-t border-gray-100 py-8 text-center">
        <p className="text-gray-400 text-sm">© 2026 RentEase. All rights reserved.</p>
      </footer>
    </div>
  );
}
