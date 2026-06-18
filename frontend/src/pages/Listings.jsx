import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, MapPin, User, Search, BedDouble, ArrowLeft, ShieldCheck } from 'lucide-react';

const BASE = 'http://localhost:8000';

const CATEGORY_LABEL = { hostel: 'Hostel', apartment: 'Apartment', house: 'House' };
const CATEGORY_COLORS = {
  hostel:    'bg-blue-100 text-blue-700',
  apartment: 'bg-purple-100 text-purple-700',
  house:     'bg-green-100 text-green-700',
};

const SORT_OPTIONS = [
  { value: 'newest',    label: 'Newest' },
  { value: 'price_asc', label: 'Price Low–High' },
  { value: 'price_desc', label: 'Price High–Low' },
];

function fmtPrice(min, max) {
  if (!min && !max) return 'Price not set';
  const from = min === max || !max;
  const num = Number(min || max).toLocaleString();
  return from ? `Rs ${num} / bed` : `From Rs ${Number(min).toLocaleString()} / bed`;
}

function ListingCard({ listing, onClick }) {
  const photoUrl = listing.primary_photo
    ? `${listing.primary_photo}`
    : null;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-md hover:border-blue-200 transition-all duration-200 group"
    >
      {/* Photo */}
      <div className="relative aspect-video bg-gray-100 overflow-hidden">
        {photoUrl ? (
          <img src={photoUrl} alt={listing.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
            <Building2 size={48} />
            <p className="text-sm mt-2 text-gray-400">No photo</p>
          </div>
        )}
        <span className={`absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-semibold ${CATEGORY_COLORS[listing.category] || 'bg-gray-100 text-gray-600'}`}>
          {CATEGORY_LABEL[listing.category] || listing.category || 'Property'}
        </span>
        {listing.available_beds > 0 && (
          <span className="absolute top-3 right-3 px-2.5 py-1 bg-green-500 text-white rounded-full text-xs font-semibold flex items-center gap-1">
            <BedDouble size={11} /> {listing.available_beds} bed{listing.available_beds !== 1 ? 's' : ''} free
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-center gap-1.5 mb-1">
          <h3 className="font-bold text-gray-800 text-base leading-tight line-clamp-1 group-hover:text-blue-700 transition-colors flex-1">
            {listing.property_name}
          </h3>
          <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full shrink-0">
            <ShieldCheck size={11} /> Verified
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-2 line-clamp-1">{listing.title}</p>

        <div className="flex items-start gap-1.5 text-gray-500 text-xs mb-1">
          <MapPin size={12} className="shrink-0 mt-0.5" />
          <span className="line-clamp-1">{listing.address || 'Address not set'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-3">
          <User size={12} className="shrink-0" />
          <span>{listing.landlord_name}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-blue-700">{fmtPrice(listing.min_price, listing.max_price)}</span>
          <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition">
            View Details
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Listings() {
  const navigate = useNavigate();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('newest');

  useEffect(() => {
    fetch(`${BASE}/listings`)
      .then((r) => r.json())
      .then((d) => setListings(Array.isArray(d) ? d : []))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, []);

  const hasFilters = search || category || minPrice || maxPrice;

  function clearFilters() {
    setSearch('');
    setCategory('');
    setMinPrice('');
    setMaxPrice('');
    setSort('newest');
  }

  let filtered = listings.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      l.property_name?.toLowerCase().includes(q) ||
      l.address?.toLowerCase().includes(q) ||
      l.title?.toLowerCase().includes(q);
    const matchCat = !category || l.category === category;
    const matchMin = !minPrice || (l.min_price && Number(l.min_price) >= Number(minPrice));
    const matchMax = !maxPrice || (l.max_price && Number(l.max_price) <= Number(maxPrice));
    return matchSearch && matchCat && matchMin && matchMax;
  });

  filtered = [...filtered].sort((a, b) => {
    if (sort === 'price_asc') return (a.min_price || 0) - (b.min_price || 0);
    if (sort === 'price_desc') return (b.min_price || 0) - (a.min_price || 0);
    return 0;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-blue-900 via-indigo-800 to-violet-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <Link to="/" className="flex items-center gap-2 text-white/80 hover:text-white transition text-sm">
              <ArrowLeft size={16} />
              <span>Back to Home</span>
            </Link>
            <button onClick={() => navigate('/login')}
              className="px-5 py-2 bg-white text-blue-700 rounded-xl font-semibold text-sm hover:opacity-90 transition">
              Sign In
            </button>
          </div>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Building2 size={22} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold">RentEase</h1>
          </div>
          <h2 className="text-3xl font-bold mb-1">Available Properties</h2>
          <p className="text-white/75 text-sm">Browse verified rental properties in your area</p>

          {/* Search row */}
          <div className="mt-5">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, location, or description..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white text-gray-800 text-sm outline-none shadow-sm"
              />
            </div>
          </div>

          {/* Filter row */}
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            {/* Type tabs */}
            <div className="flex gap-1 bg-white/10 rounded-xl p-1">
              {[{ value: '', label: 'All' }, { value: 'hostel', label: 'Hostel' }, { value: 'apartment', label: 'Apartment' }, { value: 'house', label: 'House' }].map(({ value, label }) => (
                <button key={value} onClick={() => setCategory(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    category === value ? 'bg-white text-blue-700 shadow' : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Price range */}
            <input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="Min Rs"
              className="w-28 px-3 py-1.5 rounded-xl bg-white text-gray-800 text-sm outline-none shadow-sm"
            />
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="Max Rs"
              className="w-28 px-3 py-1.5 rounded-xl bg-white text-gray-800 text-sm outline-none shadow-sm"
            />

            {/* Sort */}
            <select value={sort} onChange={(e) => setSort(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-white text-gray-700 text-sm outline-none shadow-sm">
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Listings grid */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
                <div className="aspect-video bg-gray-200" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <Building2 size={64} className="mx-auto mb-4 text-gray-200" />
            <p className="text-xl font-semibold text-gray-500">
              {hasFilters ? 'No properties match your filters.' : 'No properties available right now.'}
            </p>
            <p className="text-gray-400 text-sm mt-2">
              {hasFilters ? 'Try adjusting your search.' : 'Check back soon!'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4">
              {filtered.length} propert{filtered.length !== 1 ? 'ies' : 'y'} found
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((l) => (
                <ListingCard key={l.id} listing={l} onClick={() => navigate(`/listings/${l.id}`)} />
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="border-t border-gray-100 py-6 text-center">
        <p className="text-gray-400 text-sm">© 2026 RentEase. All rights reserved.</p>
      </footer>
    </div>
  );
}
