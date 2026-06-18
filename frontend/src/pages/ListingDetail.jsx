import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Building2, MapPin, User, Phone, Mail, BedDouble, ArrowLeft, ChevronRight, Send, ShieldCheck } from 'lucide-react';

const BASE = 'http://localhost:8000';

const CATEGORY_LABEL = { hostel: 'Hostel', apartment: 'Apartment', house: 'House' };
const CATEGORY_COLORS = {
  hostel:    'bg-blue-100 text-blue-700',
  apartment: 'bg-purple-100 text-purple-700',
  house:     'bg-green-100 text-green-700',
};

const PHONE_RE = /^(03\d{2}-\d{7}|\+92-\d{3}-\d{7})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mainPhotoIdx, setMainPhotoIdx] = useState(0);

  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Report toast
  const [reportToast, setReportToast] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/listings/${id}`)
      .then(async (r) => {
        if (!r.ok) { setNotFound(true); return; }
        const d = await r.json();
        setListing(d);
        const primaryIdx = d.photos?.findIndex((p) => p.is_primary) ?? 0;
        setMainPhotoIdx(Math.max(0, primaryIdx));
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  function validateForm() {
    const errs = {};
    if (!form.name.trim() || form.name.trim().length < 2 || !/^[a-zA-Z\s]+$/.test(form.name.trim())) {
      errs.name = 'Please enter a valid name';
    }
    if (!form.phone.trim() || !PHONE_RE.test(form.phone.trim())) {
      errs.phone = 'Enter a valid Pakistani phone number (03XX-XXXXXXX)';
    }
    if (!form.email.trim() || !EMAIL_RE.test(form.email.trim())) {
      errs.email = 'Enter a valid email address';
    }
    return errs;
  }

  async function handleInquire(e) {
    e.preventDefault();
    setSubmitError('');
    const errs = validateForm();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/listings/${id}/inquire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed to send inquiry');
      setSuccess(true);
      setForm({ name: '', email: '', phone: '', message: '' });
    } catch (err) {
      setSubmitError(err.message || 'Failed to send inquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function showReportToast() {
    setReportToast(true);
    setTimeout(() => setReportToast(false), 3000);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Loading listing...</div>
      </div>
    );
  }

  if (notFound || !listing) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <Building2 size={56} className="text-gray-300" />
        <p className="text-xl font-semibold text-gray-500">Listing not found</p>
        <Link to="/listings" className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1">
          <ArrowLeft size={14} /> Back to listings
        </Link>
      </div>
    );
  }

  const photos = listing.photos || [];
  const activePhotoUrl = photos.length > 0 ? `${photos[mainPhotoIdx]?.photo_url}` : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Report toast */}
      {reportToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-gray-800 text-white rounded-xl shadow-lg text-sm">
          Thank you for your report. We will review it.
        </div>
      )}

      {/* Header bar */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-800 text-white py-4 px-4 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/listings" className="flex items-center gap-2 text-white/80 hover:text-white transition text-sm">
            <ArrowLeft size={16} />
            <span>All Listings</span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-white/70 hidden sm:flex">
            <span>{listing.property_name}</span>
            <ChevronRight size={14} />
            <span className="text-white">{listing.title}</span>
          </div>
          <button onClick={() => navigate('/login')}
            className="px-4 py-1.5 bg-white text-blue-700 rounded-lg text-sm font-semibold hover:opacity-90 transition">
            Sign In
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Left: photos + details */}
          <div className="flex-1 min-w-0">
            {/* Photo gallery */}
            <div className="mb-6">
              <div className="w-full max-h-80 bg-gray-200 rounded-2xl overflow-hidden mb-2">
                {activePhotoUrl ? (
                  <img src={activePhotoUrl} alt="property"
                    className="w-full h-80 object-cover rounded-2xl" />
                ) : (
                  <div className="w-full h-80 flex flex-col items-center justify-center text-gray-300">
                    <Building2 size={64} />
                    <p className="text-sm mt-2 text-gray-400">No photos available</p>
                  </div>
                )}
              </div>
              {photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1 mt-2">
                  {photos.map((p, i) => (
                    <button key={p.id} onClick={() => setMainPhotoIdx(i)}
                      className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition cursor-pointer ${
                        mainPhotoIdx === i ? 'ring-2 ring-blue-500 border-blue-500' : 'border-transparent hover:border-gray-300'
                      }`}>
                      <img src={p.photo_url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Title + badges */}
            <div className="mb-4">
              <div className="flex items-start gap-2 flex-wrap mb-1">
                <h1 className="text-2xl font-bold text-gray-800">{listing.property_name}</h1>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold mt-1 ${CATEGORY_COLORS[listing.category] || 'bg-gray-100 text-gray-600'}`}>
                  {CATEGORY_LABEL[listing.category] || listing.category}
                </span>
                <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mt-1">
                  <ShieldCheck size={11} /> Verified
                </span>
              </div>
              <p className="text-base text-gray-600 font-medium">{listing.title}</p>
            </div>

            {/* Description */}
            {listing.description && (
              <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">About this property</h2>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{listing.description}</p>
              </div>
            )}

            {/* Available Rooms */}
            {listing.rooms?.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <BedDouble size={15} className="text-blue-600" /> Available Rooms
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        {['Room No', 'Total Beds', 'Available', 'Price / Bed'].map((h) => (
                          <th key={h} className="px-3 py-2.5 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {listing.rooms.map((r, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="px-3 py-2.5 font-medium text-gray-800">{r.room_number}</td>
                          <td className="px-3 py-2.5 text-gray-600">{r.max_beds}</td>
                          <td className="px-3 py-2.5">
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              {r.available} free
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-semibold text-blue-700">
                            Rs {Number(r.price_per_bed).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Report link */}
            <div className="mt-6 text-center">
              <button onClick={showReportToast}
                className="text-xs text-gray-400 hover:text-gray-600 underline">
                Report this listing
              </button>
            </div>
          </div>

          {/* Right: sticky sidebar */}
          <div className="lg:w-80 xl:w-96 shrink-0">
            <div className="sticky top-6 space-y-4">

              {/* Property info */}
              <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Property Info</h2>
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-start gap-2 text-gray-600">
                    <MapPin size={14} className="shrink-0 mt-0.5 text-gray-400" />
                    <span>{listing.address || 'Address not set'}</span>
                  </div>
                  {listing.available_beds > 0 && (
                    <div className="flex items-center gap-2 text-green-700">
                      <BedDouble size={14} className="shrink-0" />
                      <span>{listing.available_beds} bed{listing.available_beds !== 1 ? 's' : ''} available</span>
                    </div>
                  )}
                  {(listing.min_price || listing.max_price) && (
                    <div className="flex items-center gap-2 text-blue-700 font-semibold">
                      <span>
                        {listing.min_price === listing.max_price
                          ? `Rs ${Number(listing.min_price).toLocaleString()} / bed`
                          : `Rs ${Number(listing.min_price).toLocaleString()} – ${Number(listing.max_price).toLocaleString()} / bed`}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact */}
              <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Contact Landlord</h2>
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center gap-2 text-gray-700">
                    <User size={14} className="text-gray-400" />
                    <span className="font-medium">{listing.landlord_name}</span>
                  </div>
                  {listing.landlord_phone && (
                    <a href={`tel:${listing.landlord_phone}`}
                      className="flex items-center gap-2 px-3 py-2 border border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition text-sm font-medium">
                      <Phone size={14} /> Call Now
                    </a>
                  )}
                  {listing.landlord_email && (
                    <a href={`mailto:${listing.landlord_email}`}
                      className="flex items-center gap-2 px-3 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition text-sm font-medium">
                      <Mail size={14} /> Send Email
                    </a>
                  )}
                </div>
              </div>

              {/* Inquiry form */}
              <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <Send size={14} className="text-blue-600" /> Send an Inquiry
                </h2>

                {success ? (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 text-center">
                    <p className="font-semibold mb-1">Inquiry sent!</p>
                    <p>The landlord will contact you shortly.</p>
                  </div>
                ) : (
                  <form onSubmit={handleInquire} className="space-y-3">
                    {submitError && (
                      <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs">{submitError}</div>
                    )}

                    {/* Name */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Your Name *</label>
                      <input type="text" value={form.name}
                        onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((p) => ({ ...p, name: '' })); }}
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${errors.name ? 'border-red-400' : 'border-gray-200'}`}
                      />
                      {errors.name && <p className="text-red-500 text-xs mt-0.5">{errors.name}</p>}
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Your Phone *</label>
                      <input type="tel" value={form.phone}
                        onChange={(e) => { setForm({ ...form, phone: e.target.value }); setErrors((p) => ({ ...p, phone: '' })); }}
                        placeholder="03XX-XXXXXXX"
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${errors.phone ? 'border-red-400' : 'border-gray-200'}`}
                      />
                      {errors.phone && <p className="text-red-500 text-xs mt-0.5">{errors.phone}</p>}
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Your Email *</label>
                      <input type="email" value={form.email}
                        onChange={(e) => { setForm({ ...form, email: e.target.value }); setErrors((p) => ({ ...p, email: '' })); }}
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${errors.email ? 'border-red-400' : 'border-gray-200'}`}
                      />
                      {errors.email && <p className="text-red-500 text-xs mt-0.5">{errors.email}</p>}
                    </div>

                    {/* Message */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Message (optional)</label>
                      <textarea value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.target.value })}
                        rows={3}
                        placeholder="I am interested in this property..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                      />
                    </div>

                    <button type="submit" disabled={submitting}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-60 flex items-center justify-center gap-2">
                      {submitting ? 'Sending...' : <><Send size={14} /> Send Inquiry</>}
                    </button>
                  </form>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      <footer className="border-t border-gray-100 py-6 text-center mt-8">
        <p className="text-gray-400 text-sm">© 2026 RentEase. All rights reserved.</p>
      </footer>
    </div>
  );
}
