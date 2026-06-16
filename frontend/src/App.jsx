import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

import Landing from './pages/Landing';
import Login from './pages/Login';
import Listings from './pages/Listings';
import ListingDetail from './pages/ListingDetail';

import AdminLayout from './pages/admin/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminLandlords from './pages/admin/AdminLandlords';
import AdminLandlordDetail from './pages/admin/AdminLandlordDetail';
import AdminProperties from './pages/admin/AdminProperties';
import AdminTenants from './pages/admin/AdminTenants';
import AdminRevenue from './pages/admin/AdminRevenue';
import AdminHistory from './pages/admin/AdminHistory';
import AdminListings from './pages/admin/AdminListings';

import LandlordLayout from './pages/landlord/LandlordLayout';
import Overview from './pages/landlord/Overview';
import Properties from './pages/landlord/Properties';
import Tenants from './pages/landlord/Tenants';
import Maintenance from './pages/landlord/Maintenance';
import Complaints from './pages/landlord/Complaints';
import Notices from './pages/landlord/Notices';
import Reports from './pages/landlord/Reports';
import LandlordListings from './pages/landlord/Listings';

import TenantLayout from './pages/tenant/TenantLayout';
import MyRoom from './pages/tenant/MyRoom';
import TenantRent from './pages/tenant/TenantRent';
import TenantMaintenance from './pages/tenant/TenantMaintenance';
import TenantComplaints from './pages/tenant/TenantComplaints';
import TenantNotices from './pages/tenant/TenantNotices';

function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/listings" element={<Listings />} />
          <Route path="/listings/:id" element={<ListingDetail />} />

          <Route path="/admin" element={<RequireRole role="superadmin"><AdminLayout /></RequireRole>}>
            <Route index element={<AdminDashboard />} />
            <Route path="landlords" element={<AdminLandlords />} />
            <Route path="landlords/:id" element={<AdminLandlordDetail />} />
            <Route path="properties" element={<AdminProperties />} />
            <Route path="tenants" element={<AdminTenants />} />
            <Route path="revenue" element={<AdminRevenue />} />
            <Route path="history" element={<AdminHistory />} />
            <Route path="listings" element={<AdminListings />} />
          </Route>

          <Route path="/landlord" element={<RequireRole role="landlord"><LandlordLayout /></RequireRole>}>
            <Route index element={<Overview />} />
            <Route path="properties" element={<Properties />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="maintenance" element={<Maintenance />} />
            <Route path="complaints" element={<Complaints />} />
            <Route path="notices" element={<Notices />} />
            <Route path="reports" element={<Reports />} />
            <Route path="listings" element={<LandlordListings />} />
          </Route>

          <Route path="/tenant" element={<RequireRole role="tenant"><TenantLayout /></RequireRole>}>
            <Route index element={<MyRoom />} />
            <Route path="rent" element={<TenantRent />} />
            <Route path="maintenance" element={<TenantMaintenance />} />
            <Route path="complaints" element={<TenantComplaints />} />
            <Route path="notices" element={<TenantNotices />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
