# RentEase — Multi-Tenant Hostel Management SaaS

A full-stack property management platform built for hostel and rental property owners. Three distinct portals (Super Admin, Landlord, Tenant) handle everything from bed-level occupancy tracking to automated rent collection, PDF reports, and platform billing.

**Live Demo:** [rentease.vercel.app](https://rentease.vercel.app) <!-- update with your actual URL -->

---

## Demo Credentials

| Role       | Email                     | Password  |
|------------|---------------------------|-----------|
| Super Admin | admin@rentease.com       | admin123  |
| Landlord   | landlord@demo.com         | demo123   |
| Tenant     | tenant@demo.com           | demo123   |

---

## Features

### Super Admin Portal
- Manage and approve landlord registrations
- Monitor platform-wide stats (total properties, tenants, revenue)
- Control platform fee billing and subscription status
- Cascade deactivation and deletion of landlord accounts

### Landlord Portal
- Add and manage properties, rooms, and beds
- Onboard tenants and assign them to specific beds
- Automated monthly rent generation via APScheduler
- Track rent payments with upload verification
- Submit and track maintenance requests and tenant complaints
- Post notices to tenants
- Export detailed PDF reports (tenancy summaries, revenue breakdowns)
- Interactive analytics dashboard with charts (Recharts)
- Public vacancy listings page for prospective tenants

### Tenant Portal
- View room assignment and rent history
- Upload rent payment receipts
- Submit maintenance requests and complaints
- Read notices from landlord
- Download rent receipts as PDFs

---

## Tech Stack

**Backend**
- Python FastAPI
- SQLite (raw SQL, no ORM)
- JWT authentication via `python-jose`
- Password hashing via `hashlib pbkdf2_hmac` + `secrets`
- PDF generation via ReportLab
- Scheduled tasks via APScheduler

**Frontend**
- React 18 + Vite
- Tailwind CSS
- React Router v6
- Axios
- Recharts (analytics charts)

---

## Getting Started

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

API runs at `http://localhost:8000`  
Swagger docs: `http://localhost:8000/docs`

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`

---

## Project Structure

```
rentease/
├── backend/
│   ├── main.py              — FastAPI app, all routes and business logic
│   ├── database.py          — SQLite connection and schema setup
│   ├── auth.py              — JWT token creation and verification
│   ├── pdf_reports.py       — ReportLab PDF generation (receipts, reports)
│   ├── scheduler.py         — APScheduler auto rent generation
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── admin/       — Super Admin portal pages
│   │   │   ├── landlord/    — Landlord portal pages
│   │   │   └── tenant/      — Tenant portal pages
│   │   ├── components/      — Shared UI components
│   │   └── api/             — Axios API client
│   └── package.json
└── README.md
```

---

## Deployment

- **Frontend:** Vercel (set root directory to `frontend`)
- **Backend:** Railway or Render (set start command to `uvicorn main:app --host 0.0.0.0 --port $PORT`)
- Set `VITE_API_URL` in Vercel environment variables to point to your deployed backend URL

---

## Notes

- All prices are stored as integers (paisas/smallest unit) to avoid floating point issues
- All list queries use `ORDER BY name ASC` for consistent ordering
- `COALESCE` is used throughout SQL queries for null safety
- The SQLite database is seeded with demo data on first run for easy testing
