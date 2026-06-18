import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ExternalLink, FileDown } from 'lucide-react';
import api from '../../api/client';
import Spinner from '../../components/Spinner';

import { BASE_URL as BASE } from '../../api/config';
const token = () => localStorage.getItem('token');
import { fmtDate, fmtMonthYear, toTitleCase, fmtCurrency } from '../../utils/format.jsx';

const NA = () => <span className="text-gray-400 text-sm">Not set</span>;

const STATUS_BADGE = {
  active:   'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-700',
};

function InfoCard({ label, children }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</p>
      <div className="text-sm font-semibold text-gray-800">{children}</div>
    </div>
  );
}

export default function AdminLandlordDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function load() {
    setError('');
    try {
      const res = await api.get(`/admin/landlords/${id}/detail`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load landlord details');
    }
  }

  useEffect(() => { load(); }, [id]);

  async function downloadSummaryPdf() {
    setDownloadingPdf(true);
    try {
      const res = await fetch(`${BASE}/admin/landlords/${id}/summary-pdf`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `landlord_summary_${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    finally { setDownloadingPdf(false); }
  }

  async function generateBill() {
    setGenerating(true); setGenMsg('');
    try {
      const res = await api.post(`/admin/landlords/${id}/generate-platform-fee`);
      setGenMsg(res.data.message);
      await load();
    } catch (err) {
      setGenMsg(err.response?.data?.detail || 'Failed to generate bill');
    } finally { setGenerating(false); }
  }

  if (error) return (
    <div className="p-8">
      <button onClick={() => navigate('/admin/landlords')} className="text-sm text-blue-600 hover:underline mb-4 flex items-center gap-1">
        <ChevronLeft size={16} /> Back to Landlords
      </button>
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-600">{error}</p>
      </div>
    </div>
  );

  if (!data) return (
    <div className="p-8 flex items-center gap-3 text-gray-400"><Spinner small /> Loading...</div>
  );

  const { landlord, properties, tenants, platform_payments, total_paid, total_pending } = data;
  const outstanding = Math.max(0, total_pending);

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <button onClick={() => navigate('/admin/landlords')} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
        <ChevronLeft size={16} /> Back to Landlords
      </button>

      {/* Landlord Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-blue-500 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{toTitleCase(landlord.business_name || landlord.name)}</h1>
            <p className="text-gray-500 mt-0.5">{landlord.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={downloadSummaryPdf} disabled={downloadingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 disabled:opacity-60 border border-gray-200">
              {downloadingPdf ? <Spinner small /> : <FileDown size={13} />}
              Download Summary PDF
            </button>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[landlord.status] || 'bg-gray-100 text-gray-500'}`}>
              {toTitleCase(landlord.status)}
            </span>
          </div>
        </div>

        {/* Info cards grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <InfoCard label="Phone">
            {landlord.phone ? landlord.phone : <NA />}
          </InfoCard>
          <InfoCard label="CNIC">
            {landlord.cnic ? landlord.cnic : <NA />}
          </InfoCard>
          <InfoCard label="Monthly Fee">
            {(landlord.monthly_fee || 0) > 0
              ? <span className="text-gray-800">{fmtCurrency(landlord.monthly_fee)}</span>
              : <NA />
            }
          </InfoCard>
          <InfoCard label="Total Paid">
            <span className="text-green-700">{fmtCurrency(total_paid)}</span>
          </InfoCard>
          <InfoCard label="Outstanding">
            <span className={outstanding > 0 ? 'text-red-600' : 'text-gray-500'}>{fmtCurrency(outstanding)}</span>
          </InfoCard>
          <InfoCard label="Registered">
            {landlord.created_at ? fmtDate(landlord.created_at) : <NA />}
          </InfoCard>
        </div>
      </div>

      {/* Properties */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Properties ({properties.length})</h2>
        </div>
        {properties.length === 0 ? (
          <p className="px-6 py-6 text-gray-400 text-sm">No properties yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase text-left">
                {['Name', 'Type', 'Address', 'Rooms', 'Total Beds', 'Occupied Beds', 'Vacant Beds'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...properties].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((p) => (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-800">{toTitleCase(p.name)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs capitalize">{(p.property_type || '').replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.address || <NA />}</td>
                  <td className="px-4 py-3">{p.total_rooms || 0}</td>
                  <td className="px-4 py-3 text-gray-700">{p.total_beds || 0}</td>
                  <td className="px-4 py-3 font-medium text-green-600">{p.occupied_beds || 0}</td>
                  <td className="px-4 py-3 font-medium text-red-500">{p.vacant_beds || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tenants */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Tenants ({tenants.length})</h2>
        </div>
        {tenants.length === 0 ? (
          <p className="px-6 py-6 text-gray-400 text-sm">No tenants yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase text-left">
                {['Name', 'Email', 'Room', 'Property', 'Rent/mo', 'Move-in', 'Action'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...tenants].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((t) => (
                <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-800">{toTitleCase(t.name)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t.email || <NA />}</td>
                  <td className="px-4 py-3">{t.room_number || <span className="text-gray-400 text-xs">Unassigned</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{t.property_name || <NA />}</td>
                  <td className="px-4 py-3 font-medium">
                    {t.rent_amount > 0 ? fmtCurrency(t.rent_amount) : <NA />}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {t.move_in_date ? fmtDate(t.move_in_date) : <NA />}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/admin/tenants?id=${t.id}`)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-200">
                      <ExternalLink size={11} /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Platform Payments */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Platform Fee History ({platform_payments.length})</h2>
          <div className="flex items-center gap-3">
            {genMsg && <span className="text-xs text-green-600 font-medium">{genMsg}</span>}
            <button onClick={generateBill} disabled={generating || !landlord.monthly_fee}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50"
              title={!landlord.monthly_fee ? 'Set a monthly fee first' : 'Generate bill for current month'}>
              {generating && <Spinner small />}Generate This Month's Bill
            </button>
          </div>
        </div>
        {platform_payments.length === 0 ? (
          <p className="px-6 py-6 text-gray-400 text-sm">No platform fee records yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase text-left">
                {['Month', 'Amount', 'Status', 'Due Date', 'Paid On'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {platform_payments.map((p) => (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-800">{fmtMonthYear(p.month_year) || p.month_year}</td>
                  <td className="px-4 py-3">{fmtCurrency(p.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.status === 'paid' ? 'bg-green-100 text-green-700' :
                      p.status === 'pending_verification' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {p.status === 'paid' ? 'Paid' : p.status === 'pending_verification' ? 'Pending Verification' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.due_date ? fmtDate(p.due_date) : <NA />}</td>
                  <td className="px-4 py-3 text-gray-500">{p.paid_at ? fmtDate(p.paid_at) : <NA />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
