import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Modal from '../../components/Modal';
import Spinner from '../../components/Spinner';

const EMPTY_FORM = { room_number: '', capacity: 1, rent_amount: '', unit_type: 'room', description: '' };

export default function Rooms() {
  const [searchParams] = useSearchParams();
  const [rooms, setRooms] = useState([]);
  const [properties, setProperties] = useState([]);
  const [filterPid, setFilterPid] = useState(searchParams.get('property_id') || '');
  const [showModal, setShowModal] = useState(false);
  const [editRoom, setEditRoom] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [houseMode, setHouseMode] = useState('rooms'); // 'whole' | 'rooms'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [rRes, pRes] = await Promise.all([
      api.get('/rooms', { params: filterPid ? { property_id: filterPid } : {} }),
      api.get('/properties'),
    ]);
    setRooms(rRes.data);
    setProperties(pRes.data);
  }

  useEffect(() => { load(); }, [filterPid]);

  const selectedProperty = properties.find((p) => String(p.id) === String(filterPid));
  const propType = selectedProperty?.property_type || 'hostel';

  function openAdd() {
    setEditRoom(null);
    setForm(EMPTY_FORM);
    setHouseMode('rooms');
    setError('');
    setShowModal(true);
  }

  function openEdit(r) {
    setEditRoom(r);
    setForm({
      room_number: r.room_number,
      capacity: r.capacity,
      rent_amount: r.rent_amount,
      unit_type: r.unit_type || 'room',
      description: r.description || '',
    });
    setHouseMode(r.unit_type === 'whole_house' ? 'whole' : 'rooms');
    setError('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!filterPid && !editRoom) { setError('Select a property first'); return; }
    setError('');
    setLoading(true);

    // Build payload based on property type
    let payload = { ...form };
    if (propType === 'apartment') {
      payload.capacity = 1;
      payload.unit_type = 'apartment';
    } else if (propType === 'house') {
      if (houseMode === 'whole') {
        payload.unit_type = 'whole_house';
        payload.capacity = 1;
        payload.room_number = payload.room_number || 'House';
      } else {
        payload.unit_type = 'room';
      }
    } else {
      payload.unit_type = 'room';
    }

    try {
      if (editRoom) {
        await api.put(`/rooms/${editRoom.id}`, payload);
      } else {
        await api.post(`/properties/${filterPid}/rooms`, payload);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(r) {
    if (!window.confirm(`Delete ${r.room_number}? This cannot be undone.`)) return;
    try {
      await api.delete(`/rooms/${r.id}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete');
    }
  }

  // Labels based on property type
  function roomNumberLabel() {
    if (propType === 'apartment') return 'Apartment Number';
    if (propType === 'house' && houseMode === 'whole') return 'Unit Label';
    return 'Room Number';
  }

  const STATUS_STYLE = { vacant: 'bg-green-100 text-green-700', occupied: 'bg-blue-100 text-blue-700' };

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Rooms</h1>
        <div className="flex gap-3">
          <select
            value={filterPid}
            onChange={(e) => setFilterPid(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Properties</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.property_type})</option>
            ))}
          </select>
          <button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + Add Room
          </button>
        </div>
      </div>

      {rooms.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-5xl mb-4">🚪</div>
          <p className="text-lg font-medium">No rooms found</p>
          <p className="text-sm mt-1">Select a property and add rooms</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {rooms.map((r) => (
            <div key={r.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-bold text-gray-800 text-lg">{r.room_number}</p>
                  <p className="text-xs text-gray-400">{r.property_name}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
              </div>
              <div className="text-sm text-gray-600 space-y-1 mt-3">
                {r.unit_type !== 'whole_house' && r.unit_type !== 'apartment' && (
                  <p>Capacity {r.capacity}</p>
                )}
                <p className="font-semibold text-gray-800">₨ {r.rent_amount?.toLocaleString()}/mo</p>
                {r.description && <p className="text-gray-400 text-xs">{r.description}</p>}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => openEdit(r)}
                  className="flex-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  disabled={r.status === 'occupied'}
                  className="flex-1 py-1.5 border border-red-100 rounded-lg text-xs text-red-500 hover:bg-red-50 disabled:opacity-30"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal
          title={editRoom ? `Edit ${editRoom.room_number}` : 'Add Room'}
          onClose={() => setShowModal(false)}
        >
          {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <div className="space-y-4">
            {/* Property selector (add mode only) */}
            {!editRoom && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Property *</label>
                <select
                  value={filterPid}
                  onChange={(e) => setFilterPid(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select property</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.property_type})</option>)}
                </select>
              </div>
            )}

            {/* House mode toggle */}
            {propType === 'house' && !editRoom && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rental Type</label>
                <div className="flex rounded-lg bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => setHouseMode('rooms')}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${houseMode === 'rooms' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}
                  >
                    Individual Rooms
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHouseMode('whole'); setForm((f) => ({ ...f, room_number: 'House', capacity: 1 })); }}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${houseMode === 'whole' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}
                  >
                    Whole House
                  </button>
                </div>
              </div>
            )}

            {/* Room number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{roomNumberLabel()} *</label>
              <input
                value={form.room_number}
                onChange={(e) => setForm({ ...form, room_number: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder={propType === 'apartment' ? 'A-101' : propType === 'house' && houseMode === 'whole' ? 'House' : '101'}
              />
            </div>

            {/* Capacity — hide for apartment and whole house */}
            {propType !== 'apartment' && !(propType === 'house' && houseMode === 'whole') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                <input
                  type="number"
                  min="1"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: +e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            )}

            {/* Rent */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rent / Month *</label>
              <input
                type="number"
                value={form.rent_amount}
                onChange={(e) => setForm({ ...form, rent_amount: +e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="8000"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                rows={2}
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button
                onClick={handleSave}
                disabled={loading || !form.room_number || !form.rent_amount}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2 disabled:opacity-60"
              >
                {loading && <Spinner small />}
                {editRoom ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
