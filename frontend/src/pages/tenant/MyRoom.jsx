import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Home, Phone, Building, MapPin, BedDouble, User, Wrench, MessageSquare, Bell, CreditCard } from 'lucide-react';
import { fmtDate, fmtMonthYear, toTitleCase } from '../../utils/format.jsx';

const NA = () => <span className="text-gray-400 text-sm italic">Not set</span>;

const STATUS_BADGE = {
  paid:                 'bg-green-100 text-green-700',
  pending:              'bg-yellow-100 text-yellow-800',
  overdue:              'bg-red-100 text-red-700',
  pending_verification: 'bg-orange-100 text-orange-700',
};
const STATUS_LABELS = {
  paid: 'Paid', pending: 'Pending', overdue: 'Overdue',
  pending_verification: 'Awaiting Verification',
};
const RENT_CARD_COLOR = {
  paid:    { bg: 'bg-green-50 border-green-200',  val: 'text-green-700' },
  pending: { bg: 'bg-yellow-50 border-yellow-200', val: 'text-yellow-700' },
  overdue: { bg: 'bg-red-50 border-red-200',       val: 'text-red-700' },
  pending_verification: { bg: 'bg-orange-50 border-orange-200', val: 'text-orange-700' },
};

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm py-2 border-b border-gray-50 last:border-0">
      <span className="text-gray-400 font-medium">{label}</span>
      <span className="font-medium text-gray-800">{children}</span>
    </div>
  );
}

function SummaryCard({ label, value, sub, Icon, color, onClick }) {
  const palettes = {
    green:  { bg: 'bg-green-50 border-green-100',   val: 'text-green-700',  icon: 'bg-green-100 text-green-600' },
    yellow: { bg: 'bg-yellow-50 border-yellow-100',  val: 'text-yellow-700', icon: 'bg-yellow-100 text-yellow-600' },
    orange: { bg: 'bg-orange-50 border-orange-100',  val: 'text-orange-700', icon: 'bg-orange-100 text-orange-600' },
    red:    { bg: 'bg-red-50 border-red-100',         val: 'text-red-700',    icon: 'bg-red-100 text-red-600' },
    blue:   { bg: 'bg-blue-50 border-blue-100',       val: 'text-blue-700',   icon: 'bg-blue-100 text-blue-600' },
    gray:   { bg: 'bg-gray-50 border-gray-100',       val: 'text-gray-500',   icon: 'bg-gray-100 text-gray-400' },
  };
  const p = palettes[color] || palettes.gray;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick}
      className={`${p.bg} border rounded-2xl p-5 text-left w-full ${onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] transition' : ''}`}>
      {Icon && (
        <div className={`w-9 h-9 ${p.icon} rounded-xl flex items-center justify-center mb-3`}>
          <Icon size={18} />
        </div>
      )}
      <p className={`text-3xl font-bold ${p.val}`}>{value}</p>
      <p className="text-sm font-medium text-gray-700 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Tag>
  );
}

export default function MyRoom() {
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/my/dashboard').catch(() => api.get('/my/room')).then((r) => setData(r.data)).catch(() => {});
  }, []);

  if (!data) return <div className="p-8 text-gray-400">Loading...</div>;

  const { room, property, beds_taken, roommates, move_in_date, landlord, current_rent, maintenance_open, complaints_open, notices_unread } = data;

  const rentColor = current_rent ? (RENT_CARD_COLOR[current_rent.status] || RENT_CARD_COLOR.pending) : null;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">Your tenant overview</p>
      </div>

      {!room ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100 shadow-sm">
          <Home size={56} className="mx-auto mb-4 text-gray-200" />
          <p className="text-lg font-semibold text-gray-600">You haven't been assigned a room yet.</p>
          <p className="text-sm text-gray-400 mt-2">Contact your landlord to get started.</p>
        </div>
      ) : (
        <>
          {/* Row 1: 4 summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Current Month Rent card */}
            <div className={`${rentColor ? rentColor.bg : 'bg-gray-50 border-gray-100'} border rounded-2xl p-5`}>
              <div className="w-9 h-9 bg-white/60 rounded-xl flex items-center justify-center mb-3">
                <CreditCard size={18} className={rentColor ? rentColor.val : 'text-gray-400'} />
              </div>
              {current_rent ? (
                <>
                  <p className={`text-2xl font-bold ${rentColor ? rentColor.val : 'text-gray-500'}`}>
                    ₨ {current_rent.amount?.toLocaleString()}
                  </p>
                  <p className="text-sm font-medium text-gray-700 mt-1">Current Month Rent</p>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[current_rent.status] || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABELS[current_rent.status] || toTitleCase(current_rent.status)}
                  </span>
                  {current_rent.due_date && (
                    <p className="text-xs text-gray-400 mt-1">Due: {fmtDate(current_rent.due_date)}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xl font-bold text-gray-400">—</p>
                  <p className="text-sm font-medium text-gray-700 mt-1">Current Month Rent</p>
                  <p className="text-xs text-gray-400 mt-0.5">Not generated yet</p>
                </>
              )}
            </div>

            <SummaryCard
              label="Open Maintenance"
              value={maintenance_open || 0}
              sub="requests pending"
              Icon={Wrench}
              color={maintenance_open > 0 ? 'orange' : 'green'}
              onClick={() => navigate('/tenant/maintenance')}
            />
            <SummaryCard
              label="Open Complaints"
              value={complaints_open || 0}
              sub="complaints open"
              Icon={MessageSquare}
              color={complaints_open > 0 ? 'red' : 'green'}
              onClick={() => navigate('/tenant/complaints')}
            />
            <SummaryCard
              label="Unread Notices"
              value={notices_unread || 0}
              sub="unread notices"
              Icon={Bell}
              color={notices_unread > 0 ? 'blue' : 'gray'}
              onClick={() => navigate('/tenant/notices')}
            />
          </div>

          {/* Row 2: Room Details + Property */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-blue-500 p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <BedDouble size={16} className="text-blue-600" /> Room Details
              </h2>
              <InfoRow label="Room Number">Room {room.room_number}</InfoRow>
              <InfoRow label="Monthly Rent">
                <span className="font-bold text-blue-700 text-base">₨ {(room.price_per_bed || room.rent_amount || 0).toLocaleString()}</span>
              </InfoRow>
              <InfoRow label="Your Beds">
                {(room.max_beds || room.capacity) === 1
                  ? 'Whole Room (1 bed)'
                  : `${beds_taken || 1} of ${room.max_beds || room.capacity} beds`}
              </InfoRow>
              <InfoRow label="Move-in Date">{move_in_date ? fmtDate(move_in_date) : <NA />}</InfoRow>
              <div className="mt-3 pt-3 border-t border-gray-50">
                <p className="text-xs text-gray-400">
                  {beds_taken || 1} of {room.max_beds || room.capacity} bed{(room.max_beds || room.capacity) !== 1 ? 's' : ''} occupied
                  {roommates > 0 ? ` · ${roommates} other tenant${roommates > 1 ? 's' : ''} sharing` : ''}
                </p>
              </div>
              {landlord && (
                <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-2 text-sm text-gray-600">
                  <User size={13} className="text-gray-400" />
                  <span>Your Landlord:</span>
                  <span className="font-medium">{toTitleCase(landlord.business_name || landlord.name || '—')}</span>
                  {landlord.phone && (
                    <><Phone size={11} className="text-gray-400 ml-2" /><span>{landlord.phone}</span></>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-purple-400 p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Building size={16} className="text-purple-600" /> Property
              </h2>
              <InfoRow label="Name">{property?.name ? toTitleCase(property.name) : <NA />}</InfoRow>
              <InfoRow label="Address">
                {property?.address
                  ? <span className="flex items-start gap-1"><MapPin size={11} className="mt-0.5 shrink-0 text-gray-400" />{property.address}</span>
                  : <NA />}
              </InfoRow>
              <InfoRow label="Type">
                <span className="capitalize">{(property?.property_type || property?.category || '').replace(/_/g, ' ')}</span>
              </InfoRow>
            </div>
          </div>

          {/* Row 3: Quick Actions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h2>
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={() => navigate('/tenant/rent')}
                disabled={!current_rent || current_rent.status === 'paid'}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CreditCard size={14} /> Pay Rent
              </button>
              <button
                onClick={() => navigate('/tenant/maintenance')}
                className="flex items-center gap-2 px-4 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200 transition"
              >
                <Wrench size={14} /> Submit Maintenance
              </button>
              <button
                onClick={() => navigate('/tenant/complaints')}
                className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition"
              >
                <MessageSquare size={14} /> Submit Complaint
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
