import { useEffect, useState } from 'react';
import api from '../../api/client';
import Modal from '../../components/Modal';
import Spinner from '../../components/Spinner';
import { ChevronDown, ChevronUp, Hotel, Building, Home, MapPin, AlertCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { fmtDate } from '../../utils/format.jsx';

const CATEGORIES = [
  { value: 'hostel',    label: 'Hostel',    Icon: Hotel,    desc: 'Shared rooms with multiple beds' },
  { value: 'apartment', label: 'Apartment', Icon: Building, desc: 'Self-contained apartment units' },
  { value: 'house',     label: 'House',     Icon: Home,     desc: 'Whole house or individual rooms' },
];

const HOUSE_SUBTYPES = [
  { value: 'whole',      label: 'Whole House',      desc: 'One tenant rents entire house, single monthly price' },
  { value: 'individual', label: 'Individual Rooms',  desc: 'Multiple tenants, each room has beds and price' },
];

const CAT_BADGE = {
  hostel:       'bg-blue-100 text-blue-700',
  hostel_room:  'bg-blue-100 text-blue-700',
  apartment:    'bg-purple-100 text-purple-700',
  house:        'bg-green-100 text-green-700',
  whole_house:  'bg-green-100 text-green-700',
  house_room:   'bg-orange-100 text-orange-700',
};

const STATUS_CONFIG = {
  approved:        { label: 'Approved',        cls: 'bg-green-100 text-green-700' },
  pending_approval:{ label: 'Pending Approval', cls: 'bg-yellow-100 text-yellow-700' },
  rejected:        { label: 'Rejected',         cls: 'bg-red-100 text-red-600' },
};

function emptyRoom(category, subType) {
  const isSingle = category === 'apartment' || (category === 'house' && subType === 'whole');
  return {
    room_number: '',
    max_beds: isSingle ? 1 : 2,
    price_per_bed: '',
    description: '',
  };
}

export default function Properties() {
  const [properties, setProperties] = useState([]);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedRooms, setExpandedRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  // Add Property modal
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [propForm, setPropForm] = useState({ name: '', address: '', category: 'hostel', sub_type: null });
  const [rooms, setRooms] = useState([emptyRoom('hostel', null)]);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  // Edit Property modal
  const [editProp, setEditProp] = useState(null);
  const [editPropForm, setEditPropForm] = useState({ name: '', address: '' });
  const [savingEditProp, setSavingEditProp] = useState(false);
  const [editPropError, setEditPropError] = useState('');

  // Add Room modal (inline, per property)
  const [addRoomFor, setAddRoomFor] = useState(null);
  const [roomForm, setRoomForm] = useState(null);
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomError, setRoomError] = useState('');

  // Edit Room modal
  const [editRoom, setEditRoom] = useState(null);
  const [editRoomForm, setEditRoomForm] = useState({});
  const [savingEditRoom, setSavingEditRoom] = useState(false);
  const [editRoomError, setEditRoomError] = useState('');


  async function load() {
    const res = await api.get('/properties');
    setProperties(res.data);
  }

  useEffect(() => { load(); }, []);

  async function expandProperty(p) {
    if (expandedId === p.id) { setExpandedId(null); setExpandedRooms([]); return; }
    setExpandedId(p.id);
    setLoadingRooms(true);
    try {
      const res = await api.get(`/properties/${p.id}/rooms-with-tenants`);
      setExpandedRooms(res.data);
    } catch {
      try {
        const res = await api.get('/rooms', { params: { property_id: p.id } });
        setExpandedRooms(res.data.map((r) => ({ ...r, tenants: [] })));
      } catch { setExpandedRooms([]); }
    }
    finally { setLoadingRooms(false); }
  }

  async function refreshExpanded(pid) {
    try {
      const res = await api.get(`/properties/${pid}/rooms-with-tenants`);
      setExpandedRooms(res.data);
    } catch { /* ignore */ }
  }

  // ── Add Property wizard ─────────────────────────────────────────────────────

  function openAddModal() {
    setStep(1);
    setPropForm({ name: '', address: '', category: 'hostel', sub_type: null });
    setRooms([emptyRoom('hostel', null)]);
    setModalError('');
    setShowModal(true);
  }

  function handleCategoryChange(cat) {
    setPropForm((f) => ({ ...f, category: cat, sub_type: null }));
    setRooms([emptyRoom(cat, null)]);
  }

  function handleSubTypeChange(st) {
    setPropForm((f) => ({ ...f, sub_type: st }));
    setRooms([emptyRoom(propForm.category, st)]);
  }

  function addRoom() { setRooms((prev) => [...prev, emptyRoom(propForm.category, propForm.sub_type)]); }
  function removeRoom(i) { setRooms((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateRoom(i, field, val) {
    setRooms((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  async function handleSubmit() {
    setModalError('');
    if (!propForm.name.trim()) { setModalError('Property name is required.'); return; }
    if (!propForm.address.trim()) { setModalError('Address is required.'); return; }
    const isWholeHouse = (propForm.category === 'house' && propForm.sub_type === 'whole') || propForm.category === 'whole_house';
    for (const r of rooms) {
      if (!isWholeHouse && !r.room_number.trim()) { setModalError('Room number is required for each unit.'); return; }
      if (!r.price_per_bed) { setModalError('All rooms need a price.'); return; }
    }
    setSaving(true);
    try {
      await api.post('/properties', {
        name: propForm.name,
        address: propForm.address || '',
        category: propForm.category,
        sub_type: propForm.sub_type || null,
        rooms: rooms.map((r, idx) => ({
          room_number: r.room_number || `Room ${idx + 1}`,
          max_beds: Number(r.max_beds) || 1,
          price_per_bed: parseInt(r.price_per_bed) || 0,
          description: r.description || null,
        })),
      });
      setShowModal(false);
      await load();
    } catch (err) {
      setModalError(err.response?.data?.detail || 'Failed to create property');
    } finally {
      setSaving(false);
    }
  }

  // ── Edit Property ───────────────────────────────────────────────────────────

  function openEditProp(p, e) {
    e.stopPropagation();
    setEditProp(p);
    setEditPropForm({ name: p.name, address: p.address || '' });
    setEditPropError('');
  }

  async function handleEditProp() {
    if (!editPropForm.name.trim()) { setEditPropError('Name is required.'); return; }
    if (!editPropForm.address.trim()) { setEditPropError('Address is required.'); return; }
    setSavingEditProp(true);
    try {
      await api.put(`/properties/${editProp.id}`, editPropForm);
      setEditProp(null);
      await load();
    } catch (err) {
      setEditPropError(err.response?.data?.detail || 'Failed to update property');
    } finally {
      setSavingEditProp(false);
    }
  }

  // ── Add Room (inline) ───────────────────────────────────────────────────────

  function openAddRoom(p) {
    setAddRoomFor(p);
    setRoomForm(emptyRoom(p.category || p.property_type || 'hostel_room'));
    setRoomError('');
  }

  async function handleAddRoom() {
    const isWholeHouseRoom = (addRoomFor.category === 'house' && addRoomFor.sub_type === 'whole') || addRoomFor.category === 'whole_house' || addRoomFor.property_type === 'whole_house';
    if (!isWholeHouseRoom && !roomForm.room_number.trim()) {
      setRoomError('Room number is required.');
      return;
    }
    if (!roomForm.price_per_bed) {
      setRoomError('Price is required.');
      return;
    }
    setSavingRoom(true);
    try {
      const existingCount = expandedRooms.length;
      await api.post(`/properties/${addRoomFor.id}/rooms`, {
        room_number: roomForm.room_number || `Room ${existingCount + 1}`,
        max_beds: Number(roomForm.max_beds) || 1,
        price_per_bed: parseInt(roomForm.price_per_bed) || 0,
        unit_type: addRoomFor.category || addRoomFor.property_type || 'hostel',
        description: roomForm.description || null,
      });
      const pid = addRoomFor.id;
      setAddRoomFor(null);
      await load();
      await refreshExpanded(pid);
    } catch (err) {
      setRoomError(err.response?.data?.detail || 'Failed to add room');
    } finally {
      setSavingRoom(false);
    }
  }

  // ── Edit Room ───────────────────────────────────────────────────────────────

  function openEditRoom(r, e) {
    e.stopPropagation();
    setEditRoom(r);
    setEditRoomForm({
      room_number: r.room_number,
      max_beds: r.max_beds || 1,
      price_per_bed: r.price_per_bed || r.rent_amount || 0,
      description: r.description || '',
    });
    setEditRoomError('');
  }

  async function handleEditRoom() {
    if (!editRoomForm.room_number) { setEditRoomError('Room number required.'); return; }
    setSavingEditRoom(true);
    try {
      await api.put(`/rooms/${editRoom.id}`, {
        room_number: editRoomForm.room_number,
        max_beds: Number(editRoomForm.max_beds) || 1,
        price_per_bed: parseInt(editRoomForm.price_per_bed) || 0,
        description: editRoomForm.description || null,
      });
      const pid = editRoom.property_id;
      setEditRoom(null);
      await refreshExpanded(pid);
    } catch (err) {
      setEditRoomError(err.response?.data?.detail || 'Failed to update room');
    } finally {
      setSavingEditRoom(false);
    }
  }

  async function handleDeleteProperty() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/properties/${confirmDelete.id}`);
      setConfirmDelete(null);
      if (expandedId === confirmDelete.id) { setExpandedId(null); setExpandedRooms([]); }
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete property');
    } finally {
      setDeleting(false);
    }
  }

  const isSingleBed = (cat, sub) => cat === 'apartment' || (cat === 'house' && sub === 'whole') || cat === 'whole_house';
  const roomLabel = (cat, sub) => {
    if (cat === 'apartment') return 'Apartment No.';
    if (cat === 'house' && sub === 'whole') return 'House Name / ID';
    if (cat === 'whole_house') return 'House Name / ID';
    return 'Room Number';
  };
  const priceLabel = (cat, sub) => {
    if (cat === 'house' && sub === 'whole') return 'Monthly Rent (PKR)';
    if (cat === 'whole_house') return 'Monthly Rent (PKR)';
    if (cat === 'apartment') return 'Total Price (PKR/month)';
    return 'Price per Bed (PKR/month)';
  };
  const unitLabel = (cat, sub) => {
    if (cat === 'house' && sub === 'whole') return 'Whole House';
    if (cat === 'whole_house') return 'Whole House';
    if (cat === 'apartment') return 'Apartment';
    return 'Room';
  };
  const catDisplayLabel = (cat, sub) => {
    if (cat === 'hostel' || cat === 'hostel_room') return 'Hostel';
    if (cat === 'apartment') return 'Apartment';
    if (cat === 'house' || cat === 'whole_house' || cat === 'house_room') {
      if (sub === 'whole') return 'House (Whole)';
      if (sub === 'individual') return 'House (Individual Rooms)';
      return 'House';
    }
    return (cat || '').replace('_', ' ');
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">Properties</h1>
        <button
          onClick={openAddModal}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
        >
          + Add Property
        </button>
      </div>

      <div className="relative mb-6 max-w-xs">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search properties…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {properties.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Building size={56} className="mx-auto mb-4 text-gray-300" />
          <p className="text-xl font-semibold text-gray-600">No properties yet</p>
          <p className="text-sm mt-2 mb-6 text-gray-400">Add your first property to start managing rooms and tenants</p>
          <button onClick={openAddModal} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition">
            + Add Your First Property
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {[...properties]
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .filter((p) => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.address?.toLowerCase().includes(search.toLowerCase()))
            .map((p) => {
            const cat = p.category || p.property_type || 'hostel';
            const sub = p.sub_type || null;
            const status = p.status || 'approved';
            const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.approved;
            const isExpanded = expandedId === p.id;
            const totalBeds = p.total_beds || 0;
            const occupiedBeds = p.occupied_beds_total || 0;
            const availBeds = totalBeds - occupiedBeds;

            return (
              <div key={p.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {/* Property header row */}
                <div className="flex items-start gap-4 p-5 cursor-pointer hover:bg-gray-50 transition" onClick={() => expandProperty(p)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-800">{p.name}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_BADGE[cat] || 'bg-gray-100 text-gray-600'}`}>
                        {catDisplayLabel(cat, sub)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.cls}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-1"><MapPin size={12} /> {p.address || 'No address'}</p>
                  </div>

                  <div className="flex gap-6 text-center shrink-0">
                    <div><p className="font-bold text-gray-800">{p.room_count || 0}</p><p className="text-gray-400 text-xs">Units</p></div>
                    <div><p className="font-bold text-gray-800">{totalBeds}</p><p className="text-gray-400 text-xs">Total Beds</p></div>
                    <div><p className="font-bold text-green-600">{occupiedBeds}</p><p className="text-gray-400 text-xs">Occupied</p></div>
                    <div><p className="font-bold text-red-500">{availBeds}</p><p className="text-gray-400 text-xs">Available</p></div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => openEditProp(p, e)}
                      className="px-2.5 py-1 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(p); }}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      title="Delete property"
                    >
                      <Trash2 size={14} />
                    </button>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {/* Expanded rooms */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {status === 'pending_approval' && (
                      <div className="mx-4 mt-4 p-4 bg-yellow-50 border-2 border-yellow-300 rounded-xl text-sm text-yellow-800 flex items-start gap-2">
                        <AlertCircle size={18} className="shrink-0 text-yellow-600 mt-0.5" />
                        <div>
                          <p className="font-semibold">Awaiting Admin Approval</p>
                          <p className="mt-0.5">You cannot add tenants until this property is approved.</p>
                        </div>
                      </div>
                    )}
                    {status === 'rejected' && (
                      <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        ✗ This property was rejected by admin. Please contact support.
                      </div>
                    )}

                    <div className="p-4">
                      {loadingRooms ? (
                        <div className="flex items-center gap-2 text-gray-400 py-4"><Spinner small /> Loading rooms...</div>
                      ) : expandedRooms.length === 0 ? (
                        <p className="text-sm text-gray-400 py-2">No rooms added yet.</p>
                      ) : (
                        <div className="space-y-3 mb-4">
                          {expandedRooms.map((r) => {
                            const maxBeds = r.max_beds || 1;
                            const occupied = r.occupied_beds || 0;
                            const pct = maxBeds > 0 ? Math.round((occupied / maxBeds) * 100) : 0;
                            const barColor = pct === 100 ? 'bg-green-500' : pct === 0 ? 'bg-gray-200' : 'bg-blue-500';
                            const tenants = r.tenants || [];
                            return (
                              <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-bold text-gray-800">{r.room_number}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-semibold text-gray-600">
                                      ₨ {Number(r.price_per_bed || r.rent_amount || 0).toLocaleString()}/bed
                                    </span>
                                    <button
                                      onClick={(e) => openEditRoom(r, e)}
                                      className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                                    >
                                      ✏ Edit
                                    </button>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 mb-3">
                                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-xs text-gray-500 whitespace-nowrap">{occupied}/{maxBeds} beds</span>
                                </div>

                                {tenants.length === 0 ? (
                                  <p className="text-xs text-gray-400 italic">Vacant — No tenants assigned</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {tenants.map((t) => (
                                      <div key={t.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                                        <span className="font-medium text-gray-700">{t.name}</span>
                                        <div className="flex gap-3 text-gray-500">
                                          <span>{t.beds_taken} bed{t.beds_taken > 1 ? 's' : ''}</span>
                                          <span>₨ {Number(t.monthly_rent || 0).toLocaleString()}/mo</span>
                                          {t.move_in_date && <span>{fmtDate(t.move_in_date)}</span>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <button
                        onClick={() => openAddRoom(p)}
                        disabled={status === 'pending_approval'}
                        className="mt-1 px-3 py-1.5 text-sm border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        <Plus size={14} /> Add Room
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Property Modal */}
      {showModal && (
        <Modal
          title="Add Property"
          onClose={() => setShowModal(false)}
        >
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-4">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${step === s ? 'bg-blue-600 text-white' : step > s ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'}`}>{s}</div>
                <span className={`text-xs font-medium ${step === s ? 'text-blue-700' : 'text-gray-400'}`}>{s === 1 ? 'Property Details' : 'Add Units'}</span>
                {s < 2 && <div className="w-8 h-px bg-gray-200 mx-1" />}
              </div>
            ))}
          </div>
          {modalError && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded-lg text-sm">{modalError}</div>}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Property Name *</label>
                <input value={propForm.name} onChange={(e) => setPropForm({ ...propForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Block A Hostel" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <input value={propForm.address} onChange={(e) => setPropForm({ ...propForm, address: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. DHA Phase 5, Lahore" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category *</label>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIES.map((c) => (
                    <button key={c.value} type="button" onClick={() => handleCategoryChange(c.value)}
                      className={`p-3 rounded-lg border-2 text-left transition ${propForm.category === c.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <c.Icon size={20} className={propForm.category === c.value ? 'text-blue-600' : 'text-gray-500'} />
                      <p className="font-medium text-sm text-gray-800 mt-1">{c.label}</p>
                      <p className="text-xs text-gray-400">{c.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              {propForm.category === 'house' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">House Type *</label>
                  <div className="grid grid-cols-2 gap-2">
                    {HOUSE_SUBTYPES.map((s) => (
                      <button key={s.value} type="button" onClick={() => handleSubTypeChange(s.value)}
                        className={`p-3 rounded-lg border-2 text-left transition ${propForm.sub_type === s.value ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <p className="font-medium text-sm text-gray-800">{s.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{s.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
                <button onClick={() => {
                    setModalError('');
                    if (!propForm.name.trim()) { setModalError('Property name is required.'); return; }
                    if (!propForm.address.trim()) { setModalError('Address is required.'); return; }
                    if (propForm.category === 'house' && !propForm.sub_type) { setModalError('Please select Whole House or Individual Rooms.'); return; }
                    setStep(2);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Next: Add Units →</button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 -mt-1">
                {isSingleBed(propForm.category, propForm.sub_type)
                  ? `Add the ${catDisplayLabel(propForm.category, propForm.sub_type)} unit for `
                  : `Add all ${catDisplayLabel(propForm.category, propForm.sub_type)} rooms for `}
                <strong>{propForm.name}</strong>.
                {isSingleBed(propForm.category, propForm.sub_type) ? ' This unit is assigned to one tenant.' : ' Multiple tenants share beds per room.'}
              </p>
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {rooms.map((r, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit {i + 1}</span>
                      {rooms.length > 1 && <button onClick={() => removeRoom(i)} className="text-xs text-red-400 hover:text-red-600">Remove</button>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {roomLabel(propForm.category, propForm.sub_type)}
                          {((propForm.category === 'house' && propForm.sub_type === 'whole') || propForm.category === 'whole_house')
                            ? <span className="text-gray-400 font-normal"> (optional)</span>
                            : <span className="text-red-500"> *</span>}
                        </label>
                        <input value={r.room_number} onChange={(e) => updateRoom(i, 'room_number', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm" placeholder={`Room ${rooms.indexOf(r) + 1}`} />
                      </div>
                      {!isSingleBed(propForm.category, propForm.sub_type) && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Max Beds *</label>
                          <input type="number" min="1" value={r.max_beds} onChange={(e) => updateRoom(i, 'max_beds', e.target.value)}
                            className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm" />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{priceLabel(propForm.category, propForm.sub_type)} *</label>
                        <input type="number" min="0" value={r.price_per_bed} onChange={(e) => updateRoom(i, 'price_per_bed', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm" placeholder="5000" />
                      </div>
                      <div className={isSingleBed(propForm.category, propForm.sub_type) ? '' : 'col-span-2'}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                        <input value={r.description} onChange={(e) => updateRoom(i, 'description', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm" placeholder="Optional notes" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addRoom} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add another unit</button>
              <div className="flex gap-3 justify-end pt-2">
                <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600">← Back</button>
                <button onClick={handleSubmit} disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                  {saving && <Spinner small />}Submit for Approval
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Edit Property Modal */}
      {editProp && (
        <Modal title={`Edit Property — ${editProp.name}`} onClose={() => setEditProp(null)}>
          {editPropError && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded-lg text-sm">{editPropError}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Property Name *</label>
              <input value={editPropForm.name} onChange={(e) => setEditPropForm({ ...editPropForm, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
              <input value={editPropForm.address} onChange={(e) => setEditPropForm({ ...editPropForm, address: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setEditProp(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleEditProp} disabled={savingEditProp}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {savingEditProp && <Spinner small />}Save Changes
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Room Modal */}
      {addRoomFor && roomForm && (
        <Modal title={`Add Room — ${addRoomFor.name}`} onClose={() => setAddRoomFor(null)}>
          {roomError && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded-lg text-sm">{roomError}</div>}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {roomLabel(addRoomFor.category || addRoomFor.property_type, addRoomFor.sub_type)}
                {((addRoomFor.category === 'house' && addRoomFor.sub_type === 'whole') || addRoomFor.category === 'whole_house' || addRoomFor.property_type === 'whole_house')
                  ? <span className="text-gray-400 font-normal text-xs"> (optional)</span>
                  : <span className="text-red-500"> *</span>}
              </label>
              <input value={roomForm.room_number} onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder={`Room ${expandedRooms.length + 1}`} />
            </div>
            {!isSingleBed(addRoomFor.category || addRoomFor.property_type, addRoomFor.sub_type) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Beds</label>
                <input type="number" min="1" value={roomForm.max_beds} onChange={(e) => setRoomForm({ ...roomForm, max_beds: +e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{priceLabel(addRoomFor.category || addRoomFor.property_type, addRoomFor.sub_type)} *</label>
              <input type="number" min="0" value={roomForm.price_per_bed} onChange={(e) => setRoomForm({ ...roomForm, price_per_bed: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input value={roomForm.description} onChange={(e) => setRoomForm({ ...roomForm, description: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setAddRoomFor(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleAddRoom} disabled={savingRoom}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {savingRoom && <Spinner small />}Add Room
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Property Confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-gray-800">Delete Property</h3>
              <button onClick={() => setConfirmDelete(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              Are you sure you want to delete <span className="font-semibold text-gray-800">{confirmDelete.name}</span>?
            </p>
            <p className="text-sm text-red-600 mb-5">
              All rooms and any tenants assigned to this property will also be removed. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleDeleteProperty} disabled={deleting}
                className="flex-1 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Room Modal */}
      {editRoom && (
        <Modal title={`Edit Room ${editRoom.room_number}`} onClose={() => setEditRoom(null)}>
          {editRoomError && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded-lg text-sm">{editRoomError}</div>}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Room Number *</label>
              <input value={editRoomForm.room_number} onChange={(e) => setEditRoomForm({ ...editRoomForm, room_number: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Beds</label>
              <input type="number" min="1" value={editRoomForm.max_beds} onChange={(e) => setEditRoomForm({ ...editRoomForm, max_beds: +e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price per Bed (PKR)</label>
              <input type="number" min="0" value={editRoomForm.price_per_bed} onChange={(e) => setEditRoomForm({ ...editRoomForm, price_per_bed: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input value={editRoomForm.description} onChange={(e) => setEditRoomForm({ ...editRoomForm, description: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setEditRoom(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleEditRoom} disabled={savingEditRoom}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60">
                {savingEditRoom && <Spinner small />}Save Changes
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
