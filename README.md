# RentEase — Multi-Tenant Hostel Management SaaS

## Demo Credentials

| Role       | Email                  | Password |
|------------|------------------------|----------|
| Superadmin | admin@rentease.com     | admin123 |
| Landlord   | landlord@demo.com      | demo123  |
| Tenant     | tenant@demo.com        | demo123  |

---

## Setup & Running

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

API will run at http://localhost:8000  
Swagger docs: http://localhost:8000/docs

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

App will run at http://localhost:5173

---

## Tech Stack

**Backend**
- Python FastAPI
- SQLite (raw SQL, no ORM)
- JWT auth via python-jose
- Password hashing via hashlib pbkdf2_hmac + secrets

**Frontend**
- React 18 + Vite
- Tailwind CSS
- React Router v6
- Axios
- Recharts (charts)

---

## Features

- **Superadmin**: Manage landlords, view platform stats, control subscriptions
- **Landlord**: Properties, rooms, tenants, rent collection, maintenance, complaints, notices, reports
- **Tenant**: View room, pay rent with receipt upload, submit maintenance & complaints, read notices
