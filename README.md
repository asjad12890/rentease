# RentEase — Property Management SaaS

A full-stack multi-tenant property management platform 
built for hostel and rental property owners in Pakistan. 
Three distinct portals handle everything from bed-level 
occupancy tracking to automated rent collection, 
PDF reports, public vacancy listings, and platform billing.

> Built as a portfolio project by a Computer Engineering 
> student at GIK Institute.

---

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@rentease.com | admin123 |
| Landlord 1 (Hussain Hostels) | landlord1@gmail.com | Land1pass |
| Landlord 2 (Solo Rooms) | landlord2@gmail.com | Land2pass |
| Landlord 3 (Premium Properties) | landlord3@gmail.com | Land3pass |
| Tenant 1 | tenant1@gmail.com | Ten1pass |
| Tenant 2 | tenant2@gmail.com | Ten2pass |
| (Tenants 3-13 follow same pattern) | tenant3-13@gmail.com | Ten3-13pass |

---

## Features

### Landing Page
- Public landing page with hero section, feature 
  highlights, and stats
- Public vacancy listings browser at /listings
- Animated gradient design with smooth navigation

### Super Admin Portal
- Platform-wide dashboard with analytics charts
  (platform revenue history, landlord growth, 
  occupancy overview)
- Approve/reject landlord property listings
- Monitor all landlords, properties, and tenants
- Platform fee billing — generate monthly bills, 
  verify payments, apply late fees
- Cascade deactivation and hard deletion of 
  landlord accounts with full audit trail
- Admin password reset via forgot-password 
  notification flow
- Export platform revenue report as PDF
- Download landlord account summary PDF

### Landlord Portal
- Property management: hostels, apartments, 
  houses (whole or individual rooms)
- Bed-level occupancy tracking per room
- Tenant onboarding with room/bed assignment 
  and rent due day configuration
- Automated monthly rent generation via 
  APScheduler (custom day per property)
- Rent payment verification with receipt uploads
- PDF rent receipts auto-generated on confirmation
- Maintenance request management with photo 
  lightbox viewer
- Complaint management with thread view
- Notice board — post to all tenants or specific 
  tenant/property
- Analytics dashboard — rent collection trend, 
  occupancy rate by property, revenue vs fees
- Public vacancy listings — create listings with 
  photo gallery, manage inquiries
- Export property and tenant report as PDF
- Platform fee payments tracked in Reports page

### Tenant Portal
- Dashboard overview — rent status, maintenance 
  count, complaints count, unread notices
- Rent history with payment submission and 
  receipt upload
- Download confirmed rent receipts as PDF
- Submit maintenance requests with photo upload
- Submit complaints with priority levels
- View notices from landlord
- In-app notifications for all activity
- Change password via profile dropdown

### Public Listings Page (/listings)
- Browse available properties without login
- Filter by type, price range, sort options
- Photo gallery on each listing
- Verified badge on approved listings
- Contact landlord directly via phone/email
- Submit inquiry form with validation

---

## Tech Stack

### Backend
- Python FastAPI
- SQLite (raw SQL, no ORM)
- Custom token-based authentication 
  (hashlib pbkdf2_hmac)
- PDF generation via ReportLab
- Scheduled tasks via APScheduler
- File uploads stored locally in /uploads

### Frontend
- React 18 + Vite
- Tailwind CSS
- React Router v6
- Recharts (analytics charts)
- Lucide React (icons)
- Axios (API client)

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API runs at http://localhost:8000
Swagger docs: http://localhost:8000/docs

On first run the database is automatically seeded 
with demo landlords, properties, and tenants.

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

App runs at http://localhost:5173

---

## Project Structure
rentease/

├── backend/

│   ├── main.py              — All FastAPI routes,

│   │                          business logic, DB schema,

│   │                          PDF generation, scheduler

│   ├── requirements.txt

│   └── uploads/             — Local file storage

│       ├── receipts/        — Rent receipt PDFs

│       ├── maintenance/     — Maintenance photos

│       ├── complaints/      — Complaint photos

│       └── listings/        — Listing photos

├── frontend/

│   ├── src/

│   │   ├── pages/

│   │   │   ├── admin/       — Super Admin portal

│   │   │   ├── landlord/    — Landlord portal

│   │   │   └── tenant/      — Tenant portal

│   │   ├── components/      — Shared UI components

│   │   ├── api/             — API client config

│   │   └── utils/           — Date formatting, helpers

│   └── package.json

└── README.md
---

## Key Technical Decisions

- All prices stored as integers (whole rupees) to 
  avoid floating point precision issues
- All list queries use ORDER BY name ASC for 
  consistent alphabetical ordering
- COALESCE used throughout SQL for null safety
- Single main.py architecture — all routes and 
  logic in one file for simplicity
- Custom auth without third-party libraries — 
  pbkdf2_hmac for password hashing, secrets for 
  token generation
- PDF generation fully server-side via ReportLab
- APScheduler runs inside the FastAPI process for 
  scheduled rent generation

---

## Future Improvements

- In-app messaging between tenant and landlord
- Lease agreement upload and storage
- Export data to Excel
- Two-factor authentication
- Mobile responsive design
- Urdu language toggle
- Email notifications
- Deploy to Railway (backend) + Vercel (frontend)
