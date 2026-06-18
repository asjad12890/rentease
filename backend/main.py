from dotenv import load_dotenv
load_dotenv()

import os
import psycopg2
import psycopg2.extras
import hashlib
import secrets
import uuid
import string
from datetime import datetime, timedelta, date
from typing import Optional, List

IS_PRODUCTION = os.getenv("RAILWAY_ENVIRONMENT") is not None

import cloudinary
import cloudinary.uploader

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
)


def _cloudinary_public_id_from_url(url: str):
    """Extract the public_id (folder/filename, no extension) from a Cloudinary secure_url."""
    try:
        after_upload = url.split("/upload/", 1)[1]
        parts = after_upload.split("/")
        if parts and parts[0].startswith("v") and parts[0][1:].isdigit():
            parts = parts[1:]
        return "/".join(parts).rsplit(".", 1)[0]
    except Exception:
        return None

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
import io
import traceback as _traceback

try:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, PageBreak
    from reportlab.lib import colors
    HAS_REPORTLAB = True
except ImportError:
    HAS_REPORTLAB = False
    print("[WARNING] reportlab not installed — run: pip install reportlab")

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    HAS_SCHEDULER = True
except ImportError:
    HAS_SCHEDULER = False
    print("[WARNING] APScheduler not installed — run: pip install apscheduler")

SECRET_KEY = os.getenv("SECRET_KEY", "rentease-super-secret-key-2024")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

UPLOADS_DIR = "uploads"

app = FastAPI(title="RentEase API")

origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(os.path.join(UPLOADS_DIR, "listings"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

security = HTTPBearer()


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}:{key.hex()}"


def verify_password(password: str, hashed: str) -> bool:
    try:
        salt, key_hex = hashed.split(":", 1)
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


def generate_temp_password(length: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_token(user_id: int, role: str, landlord_id: Optional[int]) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "role": role, "landlord_id": landlord_id, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ── Auth dependencies ─────────────────────────────────────────────────────────

def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    return decode_token(credentials.credentials)


def require_superadmin(user=Depends(current_user)):
    if user["role"] != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user


def require_landlord(user=Depends(current_user)):
    if user["role"] != "landlord":
        raise HTTPException(status_code=403, detail="Landlord access required")
    return user


def require_tenant(user=Depends(current_user)):
    if user["role"] != "tenant":
        raise HTTPException(status_code=403, detail="Tenant access required")
    return user


# ── Notification helper ───────────────────────────────────────────────────────

def create_notification(cur, landlord_id: int, notif_type: str, message: str, link: str = ""):
    now = datetime.utcnow().isoformat()
    cur.execute(
        "INSERT INTO notifications (landlord_id,type,message,link,is_read,created_at) VALUES (%s,%s,%s,%s,0,%s)",
        (landlord_id, notif_type, message, link, now),
    )


def create_admin_notification(cur, notif_type: str, message: str, link: str = "", user_id: int = None):
    now = datetime.utcnow().isoformat()
    cur.execute(
        "INSERT INTO admin_notifications (type,message,link,is_read,created_at,user_id) VALUES (%s,%s,%s,0,%s,%s)",
        (notif_type, message, link, now, user_id),
    )


def create_tenant_notification(cur, tenant_id: int, notif_type: str, message: str):
    now = datetime.utcnow().isoformat()
    try:
        cur.execute(
            "INSERT INTO tenant_notifications (tenant_id,type,message,is_read,created_at) VALUES (%s,%s,%s,0,%s)",
            (tenant_id, notif_type, message, now),
        )
    except Exception:
        pass  # table may not exist on old DBs


# ── DB connection helper ──────────────────────────────────────────────────────

def get_db_connection():
    conn = psycopg2.connect(
        os.getenv("DATABASE_URL"),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )
    return conn


def scalar(cur):
    """Return the first column of the last fetchone() row (RealDictCursor returns dicts, not tuples)."""
    row = cur.fetchone()
    if row is None:
        return None
    return next(iter(row.values()))


# ── Overdue rent scheduler ────────────────────────────────────────────────────

def check_overdue_rent(test_date: str = None):
    """Mark pending payments overdue (due_date < check_date); escalate at day 10+."""
    print("[SCHEDULER] Running overdue rent check...")
    conn = get_db_connection()
    cur = conn.cursor()
    check_date = date.fromisoformat(test_date) if test_date else date.today()
    check_date_str = check_date.isoformat()
    print(f"[OVERDUE] Checking with date: {check_date}")
    try:
        # Pass 1: pending → overdue only when actual due_date < check_date
        cur.execute("""
            SELECT rp.id, rp.tenant_id, rp.landlord_id,
                   rp.amount, rp.month_year, rp.due_date,
                   t.name as tenant_name
            FROM rent_payments rp
            JOIN tenants t ON rp.tenant_id = t.id
            WHERE rp.status = 'pending'
            AND rp.due_date IS NOT NULL
            AND rp.due_date < %s
        """, (check_date_str,))
        rows = cur.fetchall()

        print(f"[OVERDUE] Found {len(rows)} overdue payment(s) to mark")
        count = 0
        for payment in rows:
            cur.execute("UPDATE rent_payments SET status='overdue' WHERE id=%s", (payment["id"],))
            create_tenant_notification(cur, payment["tenant_id"], "overdue",
                f"Your rent of Rs {int(payment['amount']):,} for {payment['month_year']} is overdue. Please pay immediately.")
            create_notification(cur, payment["landlord_id"], "overdue",
                f"Rent overdue: {payment['tenant_name']} has not paid Rs {int(payment['amount']):,} for {payment['month_year']}")
            count += 1

        # Pass 2: day-10 warning — only if check_date is 10th or later; check current month
        if check_date.day >= 10:
            current_month_str = check_date.strftime("%Y-%m")
            cur.execute("""
                SELECT rp.id, rp.tenant_id, rp.landlord_id,
                       rp.amount, rp.month_year, rp.due_date,
                       t.name as tenant_name
                FROM rent_payments rp
                JOIN tenants t ON rp.tenant_id = t.id
                WHERE rp.status = 'pending'
                AND rp.month_year = %s
                AND COALESCE(rp.overdue_notified, 0) = 0
            """, (current_month_str,))
            late_rows = cur.fetchall()
            for payment in late_rows:
                cur.execute("UPDATE rent_payments SET overdue_notified=1 WHERE id=%s", (payment["id"],))
                create_tenant_notification(cur, payment["tenant_id"], "overdue",
                    f"Reminder: Rent of Rs {int(payment['amount']):,} for {payment['month_year']} is still unpaid (10th of month passed).")
                create_notification(cur, payment["landlord_id"], "overdue",
                    f"Day-10 reminder: {payment['tenant_name']} — Rs {int(payment['amount']):,} for {payment['month_year']} still pending")
                create_admin_notification(cur, "overdue",
                    f"Tenant {payment['tenant_name']} has unpaid rent past day 10 — Rs {int(payment['amount']):,} for {payment['month_year']}")

        # Pass 3: day-10 warning for platform_payments still pending
        if check_date.day >= 10:
            current_month_str = check_date.strftime("%Y-%m")
            cur.execute("""
                SELECT pp.id, pp.landlord_id, pp.amount, pp.month_year, pp.due_date,
                       u.name as landlord_name
                FROM platform_payments pp
                JOIN landlords l ON pp.landlord_id = l.id
                JOIN users u ON l.user_id = u.id
                WHERE pp.status = 'pending'
                AND pp.month_year = %s
                AND COALESCE(pp.overdue_notified, 0) = 0
            """, (current_month_str,))
            late_platform = cur.fetchall()
            for pp in late_platform:
                cur.execute("UPDATE platform_payments SET overdue_notified=1 WHERE id=%s", (pp["id"],))
                create_notification(cur, pp["landlord_id"], "platform_fee",
                    f"Platform fee of Rs {int(pp['amount']):,} for {pp['month_year']} is still unpaid (10th of month passed).")
                create_admin_notification(cur, "platform_fee",
                    f"Platform fee day-10 reminder: {pp['landlord_name']} — Rs {int(pp['amount']):,} for {pp['month_year']}")

        conn.commit()
        print(f"[OVERDUE] Marked {count} payment(s) as overdue")
        return count
    finally:
        conn.close()


def auto_generate_rent(check_date=None):
    """Daily job: generate rent for tenants whose rent_due_day matches today (or check_date)."""
    today = check_date or date.today()
    current_month = today.strftime('%Y-%m')
    print(f"[AUTO-RENT] check_date={today}  day={today.day}  month={current_month}")
    conn = get_db_connection()
    cur = conn.cursor()
    count = 0
    try:
        # Diagnostic: dump all assigned tenants
        cur.execute("""
            SELECT id, name, rent_due_day, room_id, beds_taken, is_active
            FROM tenants WHERE room_id IS NOT NULL
        """)
        all_rows = cur.fetchall()
        print(f"[AUTO-RENT] {len(all_rows)} tenant(s) with room_id set:")
        for row in all_rows:
            print(f"  id={row['id']} name={row['name']!r} rent_due_day={row['rent_due_day']} "
                  f"room_id={row['room_id']} beds_taken={row['beds_taken']} is_active={row['is_active']}")

        print(f"[AUTO-RENT] Querying for COALESCE(rent_due_day,1)={today.day} ...")
        cur.execute("""
            SELECT t.id, t.room_id, t.landlord_id, t.beds_taken, t.name, t.rent_due_day,
                   r.price_per_bed
            FROM tenants t
            JOIN rooms r ON t.room_id = r.id
            JOIN properties p ON r.property_id = p.id
            WHERE t.room_id IS NOT NULL
              AND t.is_active = 1
              AND COALESCE(t.rent_due_day, 1) = %s
              AND p.status = 'approved'
        """, (today.day,))
        tenants = cur.fetchall()
        print(f"[AUTO-RENT] {len(tenants)} tenant(s) matched")
        for t in tenants:
            amount = int(t['beds_taken'] or 1) * int(t['price_per_bed'] or 0)
            print(f"[AUTO-RENT]  -> {t['name']}: beds={t['beds_taken']} price_per_bed={t['price_per_bed']} amount={amount}")
            if amount <= 0:
                print(f"[AUTO-RENT]     skip — amount=0")
                continue
            cur.execute(
                "SELECT id FROM rent_payments WHERE tenant_id=%s AND month_year=%s",
                (t['id'], current_month)
            )
            existing = cur.fetchone()
            if existing:
                print(f"[AUTO-RENT]     skip — already exists for {current_month}")
                continue
            due_date = f"{current_month}-{today.day:02d}"
            cur.execute("""
                INSERT INTO rent_payments
                (tenant_id, room_id, landlord_id, month_year, amount, status, due_date, created_at)
                VALUES (%s, %s, %s, %s, %s, 'pending', %s, NOW())
            """, (t['id'], t['room_id'], t['landlord_id'], current_month, amount, due_date))
            create_tenant_notification(
                cur, t['id'], 'rent',
                f"Rent due · Rs {amount:,} · {current_month} · Due {due_date}"
            )
            count += 1
            print(f"[AUTO-RENT]     inserted rent_payment tenant_id={t['id']}")
        conn.commit()
        print(f"[AUTO-RENT] Done — generated {count} rent entries")
        return count
    except Exception as exc:
        import traceback as _tb
        print(f"[AUTO-RENT ERROR] {exc}")
        _tb.print_exc()
        return 0
    finally:
        conn.close()


# ── PDF helpers ───────────────────────────────────────────────────────────────

def pdf_header(story, subtitle=""):
    """Append brand header using sequential paragraphs (no tables, no overlap)."""
    if not HAS_REPORTLAB:
        return
    title_style = ParagraphStyle('_brand_title',
        fontName='Helvetica-Bold', fontSize=22,
        textColor=colors.HexColor('#2563EB'),
        spaceBefore=0, spaceAfter=4)
    sub_style = ParagraphStyle('_brand_sub',
        fontName='Helvetica', fontSize=9,
        textColor=colors.HexColor('#6B7280'),
        spaceBefore=0, spaceAfter=8)
    story.append(Paragraph('RentEase', title_style))
    if subtitle:
        story.append(Paragraph(subtitle, sub_style))
    story.append(Spacer(1, 4*mm))


# ── Receipt PDF generation ────────────────────────────────────────────────────

def generate_receipt_pdf(payment_id: int):
    """Generate a styled PDF receipt for a confirmed rent payment. Returns BytesIO or None."""
    if not HAS_REPORTLAB:
        print("[PDF] reportlab not installed — run: pip install reportlab")
        return None

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT rp.id, rp.amount, rp.month_year, rp.paid_at,
                   t.name as tenant_name, t.phone as tenant_phone, t.cnic as tenant_cnic,
                   COALESCE(t.beds_taken, 1) as beds_taken,
                   r.room_number, r.max_beds,
                   p.name as property_name, p.address as property_address,
                   u.name as landlord_name, l.phone as landlord_phone
            FROM rent_payments rp
            JOIN tenants t ON rp.tenant_id = t.id
            JOIN rooms r ON rp.room_id = r.id
            JOIN properties p ON r.property_id = p.id
            JOIN landlords l ON rp.landlord_id = l.id
            JOIN users u ON l.user_id = u.id
            WHERE rp.id = %s
        """, (payment_id,))
        data = cur.fetchone()
    finally:
        conn.close()

    if not data:
        return None

    receipt_no = f"RCP-{data['id']:06d}"
    paid_raw = data["paid_at"] or datetime.utcnow().isoformat()
    try:
        paid_formatted = datetime.fromisoformat(paid_raw[:19]).strftime("%B %d, %Y")
    except Exception:
        paid_formatted = str(paid_raw)[:10]
    try:
        month_display = datetime.strptime(data["month_year"], "%Y-%m").strftime("%B %Y")
    except Exception:
        month_display = data["month_year"]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        rightMargin=20*mm, leftMargin=20*mm,
        topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story = []

    # Header: sequential paragraphs — no tables, no overlap
    pdf_header(story, "Smart Property Management Platform")
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#2563EB")))
    story.append(Spacer(1, 4*mm))
    story.append(Paragraph('<b>RENT RECEIPT</b>',
        ParagraphStyle("rcpt_title", parent=styles["Normal"], fontSize=16)))
    story.append(Paragraph(
        f'<font color="#6B7280" size="9">Receipt No: {receipt_no}  ·  Date: {paid_formatted}</font>',
        styles["Normal"]))
    story.append(Spacer(1, 6*mm))

    # 4-col detail table: TENANT | value | PROPERTY | value  (22+63+22+63 = 170mm)
    detail_data = [
        ["TENANT DETAILS", "", "PROPERTY DETAILS", ""],
        ["Name:", data["tenant_name"] or "N/A", "Property:", data["property_name"] or "N/A"],
        ["Phone:", data["tenant_phone"] or "N/A", "Address:", (data["property_address"] or "N/A")[:45]],
        ["CNIC:", data["tenant_cnic"] or "N/A", "Room:", data["room_number"] or "N/A"],
        ["", "", "Beds:", f"{data['beds_taken']} of {data['max_beds'] or 1}"],
    ]
    t1 = Table(detail_data, colWidths=[22*mm, 63*mm, 22*mm, 63*mm])
    t1.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("TEXTCOLOR", (0, 0), (0, 0), colors.HexColor("#2563EB")),
        ("TEXTCOLOR", (2, 0), (2, 0), colors.HexColor("#2563EB")),
        ("SPAN", (0, 0), (1, 0)),
        ("SPAN", (2, 0), (3, 0)),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 1), (2, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("PADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("MINROWHEIGHT", (0, 0), (-1, -1), 20),
    ]))
    story.append(t1)
    story.append(Spacer(1, 6*mm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#E2E8F0")))
    story.append(Spacer(1, 6*mm))

    # Payment box: label col + value col (40+130 = 170mm), light blue background
    amt = int(data["amount"]) if data["amount"] else 0
    pay_data = [
        [Paragraph(f'<b>Payment for {month_display}</b>', styles["Normal"]), ""],
        ["Amount:", Paragraph(f'<font size="14"><b>Rs {amt:,}</b></font>', styles["Normal"])],
        ["Status:", Paragraph('<font color="#16A34A"><b>✓ PAID</b></font>', styles["Normal"])],
        ["Paid On:", paid_formatted],
        ["Confirmed By:", data["landlord_name"] or "N/A"],
    ]
    t2 = Table(pay_data, colWidths=[40*mm, 130*mm])
    t2.setStyle(TableStyle([
        ("SPAN", (0, 0), (1, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563EB")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#EFF6FF")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("PADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("MINROWHEIGHT", (0, 0), (-1, -1), 20),
    ]))
    story.append(t2)
    story.append(Spacer(1, 10*mm))

    # Footer
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#E5E7EB")))
    story.append(Spacer(1, 4*mm))
    footer_style = ParagraphStyle("footer", parent=styles["Normal"],
        fontSize=8, textColor=colors.HexColor("#9CA3AF"), alignment=1)
    story.append(Paragraph("This is a computer-generated receipt. No signature required.", footer_style))
    story.append(Paragraph("Generated by RentEase — Smart Property Management Platform", footer_style))

    doc.build(story)
    buf.seek(0)
    return buf


def _save_receipt_pdf(rid: int, buf) -> Optional[str]:
    """Upload receipt PDF to Cloudinary; return secure_url or None on failure."""
    try:
        result = cloudinary.uploader.upload(
            buf,
            folder="rentease/receipts",
            public_id=f"receipt_{rid}",
            resource_type="auto",
            overwrite=True,
        )
        return result["secure_url"]
    except Exception as e:
        print(f"[PDF] Failed to upload receipt: {e}")
        return None


# ── Landlord / Admin PDF generators ──────────────────────────────────────────

def generate_landlord_summary_pdf(landlord_id: int):
    """Admin-use summary PDF for a single landlord."""
    if not HAS_REPORTLAB:
        return None

    print(f"[PDF] generate_landlord_summary_pdf: start landlord_id={landlord_id}")
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        print(f"[PDF] fetching landlord row...")
        cur.execute(
            "SELECT l.*, u.name, u.email FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s",
            (landlord_id,)
        )
        landlord = cur.fetchone()
        if not landlord:
            print(f"[PDF] landlord_id={landlord_id} not found — returning None")
            return None
        print(f"[PDF] landlord found: {landlord['name']}")

        print(f"[PDF] fetching approved properties...")
        cur.execute(
            "SELECT * FROM properties WHERE landlord_id=%s AND status='approved' ORDER BY name",
            (landlord_id,)
        )
        properties = cur.fetchall()
        prop_ids = [p["id"] for p in properties]
        print(f"[PDF] {len(properties)} approved properties, ids={prop_ids}")

        rooms_by_prop = {}
        for pid in prop_ids:
            print(f"[PDF] fetching rooms for property_id={pid}...")
            cur.execute(
                """SELECT room_number, max_beds, price_per_bed,
                          COALESCE(occupied_beds, 0) as occupied_beds,
                          COALESCE(status, 'vacant') as status
                   FROM rooms WHERE property_id=%s ORDER BY room_number""",
                (pid,)
            )
            rooms_by_prop[pid] = cur.fetchall()

        print(f"[PDF] fetching tenant count...")
        cur.execute(
            "SELECT COUNT(*) FROM tenants WHERE landlord_id=%s AND is_active=1", (landlord_id,)
        )
        tenant_count = scalar(cur)

        print(f"[PDF] fetching platform payments...")
        cur.execute(
            "SELECT month_year, amount, status, paid_at FROM platform_payments WHERE landlord_id=%s ORDER BY month_year DESC",
            (landlord_id,)
        )
        platform_payments = cur.fetchall()

        print(f"[PDF] fetching financial totals...")
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE landlord_id=%s AND status='paid'", (landlord_id,)
        )
        platform_fees_paid = float(scalar(cur) or 0)
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND status='paid'", (landlord_id,)
        )
        rent_collected = float(scalar(cur) or 0)
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND status='pending'", (landlord_id,)
        )
        rent_pending = float(scalar(cur) or 0)
        print(f"[PDF] data fetch complete — props={len(properties)}, tenants={tenant_count}, fees_paid={platform_fees_paid}, rent_collected={rent_collected}")
    except Exception as exc:
        import traceback as _tb
        print(f"[PDF ERROR] data fetch failed: {exc}")
        _tb.print_exc()
        return None
    finally:
        if conn:
            conn.close()

    try:
        print(f"[PDF] building PDF story...")
        gen_date = datetime.utcnow().strftime("%B %d, %Y")
        name = (landlord["business_name"] or landlord["name"] or "Landlord")

        BLUE = colors.HexColor('#2563EB')
        ROW_ALT = colors.HexColor('#F8FAFC')

        def _ts():
            return [
                ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                ('FONTSIZE', (0,0), (-1,0), 9),
                ('BACKGROUND', (0,0), (-1,0), BLUE),
                ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
                ('FONTSIZE', (0,1), (-1,-1), 9),
                ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, ROW_ALT]),
                ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
                ('PADDING', (0,0), (-1,-1), 6),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ]

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4,
            rightMargin=20*mm, leftMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)
        styles = getSampleStyleSheet()
        story = []

        title_s = ParagraphStyle('ls_title', fontName='Helvetica-Bold', fontSize=16,
            textColor=colors.HexColor('#1E293B'))
        shdr_s = ParagraphStyle('ls_shdr', fontName='Helvetica-Bold', fontSize=12, textColor=BLUE)
        small_s = ParagraphStyle('ls_small', fontName='Helvetica', fontSize=8,
            textColor=colors.HexColor('#6B7280'))
        footer_s = ParagraphStyle('ls_footer', fontName='Helvetica', fontSize=8,
            textColor=colors.HexColor('#9CA3AF'), alignment=1)

        pdf_header(story, "Smart Property Management Platform")
        story.append(HRFlowable(width="100%", thickness=2, color=BLUE))
        story.append(Spacer(1, 8))
        story.append(Paragraph(f'Landlord Summary — {name}', title_s))
        story.append(Spacer(1, 4))
        story.append(Paragraph(f'Generated: {gen_date}', small_s))
        story.append(Spacer(1, 16))

        # Section 1: Profile [120+362=482pt]
        print(f"[PDF] building profile section...")
        story.append(Paragraph('Profile', shdr_s))
        story.append(Spacer(1, 8))
        member_since = (landlord["created_at"] or "")[:10] or "—"
        profile_data = [
            ['Field', 'Value'],
            ['Email',         landlord['email'] or 'Not provided'],
            ['Phone',         landlord['phone'] or 'Not provided'],
            ['Business Name', landlord['business_name'] or 'Not provided'],
            ['Status',        (landlord['status'] or '').capitalize() or 'Not provided'],
            ['Member Since',  member_since],
        ]
        p_tbl = Table(profile_data, colWidths=[120, 362], repeatRows=1)
        p_tbl.setStyle(TableStyle(_ts()))
        story.append(p_tbl)
        story.append(Spacer(1, 16))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E2E8F0')))
        story.append(Spacer(1, 16))

        # Section 2: Financial Summary [96+96+97+97+96=482pt]
        print(f"[PDF] building financial section...")
        story.append(Paragraph('Financial Summary', shdr_s))
        story.append(Spacer(1, 8))
        fin_data = [
            ['Total Properties', 'Tenants', 'Rent Collected', 'Pending Rent', 'Platform Fees Paid'],
            [str(len(properties)), str(int(tenant_count or 0)),
             f'Rs {int(rent_collected):,}', f'Rs {int(rent_pending):,}',
             f'Rs {int(platform_fees_paid):,}'],
        ]
        f_tbl = Table(fin_data, colWidths=[96, 96, 97, 97, 96], repeatRows=1)
        f_tbl.setStyle(TableStyle(_ts() + [('ALIGN', (0,0), (-1,-1), 'CENTER')]))
        story.append(f_tbl)
        story.append(Spacer(1, 16))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E2E8F0')))
        story.append(Spacer(1, 16))

        # Section 3: Properties & Rooms
        print(f"[PDF] building properties & rooms section...")
        story.append(Paragraph('Properties & Rooms', shdr_s))
        for prop in properties:
            story.append(Spacer(1, 8))
            ptype = (prop['property_type'] or '').replace('_', ' ').title()
            story.append(Paragraph(
                f'<b>{prop["name"] or "Unnamed"}</b>  '
                f'<font color="#6B7280" size="8">· {ptype or "Not provided"} · {prop["address"] or "No address"}</font>',
                styles['Normal']))
            story.append(Spacer(1, 4))
            rooms = rooms_by_prop.get(prop['id'], [])
            if rooms:
                r_data = [['Room', 'Max Beds', 'Occupied', 'Price/Bed', 'Revenue']] + [
                    [r['room_number'] or 'Not provided',
                     str(int(r['max_beds'] or 0)),
                     str(int(r['occupied_beds'] or 0)),
                     f'Rs {int(r["price_per_bed"] or 0):,}',
                     f'Rs {int((r["price_per_bed"] or 0) * int(r["occupied_beds"] or 0)):,}']
                    for r in rooms
                ]
                r_tbl = Table(r_data, colWidths=[80, 80, 80, 122, 120], repeatRows=1)
                r_tbl.setStyle(TableStyle(_ts()))
                story.append(r_tbl)
            else:
                story.append(Paragraph(
                    '<font color="#9CA3AF" size="8">No rooms.</font>', styles['Normal']))
        story.append(Spacer(1, 16))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E2E8F0')))
        story.append(Spacer(1, 16))

        # Section 4: Platform Fee History [120+120+122+120=482pt]
        print(f"[PDF] building platform fee history section...")
        story.append(Paragraph('Platform Fee History', shdr_s))
        story.append(Spacer(1, 8))
        if platform_payments:
            pp_data = [['Date', 'Amount', 'Status', 'Paid On']] + [
                [pp['month_year'] or '—',
                 f'Rs {int(pp["amount"] or 0):,}',
                 (pp['status'] or '').replace('_', ' ').title() or 'Not provided',
                 (pp['paid_at'] or '—')[:10]]
                for pp in platform_payments
            ]
            pp_tbl = Table(pp_data, colWidths=[120, 120, 122, 120], repeatRows=1)
            pp_tbl.setStyle(TableStyle(_ts()))
            story.append(pp_tbl)
        else:
            story.append(Paragraph(
                '<font color="#9CA3AF" size="8">No platform fee records yet.</font>', styles['Normal']))

        story.append(Spacer(1, 16))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E5E7EB')))
        story.append(Spacer(1, 8))
        story.append(Paragraph('Generated by RentEase — Smart Property Management Platform', footer_s))

        print(f"[PDF] calling doc.build()...")
        doc.build(story)
        buf.seek(0)
        print(f"[PDF] generate_landlord_summary_pdf: done")
        return buf
    except Exception as exc:
        import traceback as _tb
        print(f"[PDF ERROR] PDF build failed: {exc}")
        _tb.print_exc()
        return None


def generate_landlord_export_pdf(landlord_id: int):
    """Self-serve export PDF for landlord's property report."""
    if not HAS_REPORTLAB:
        return None

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT l.*, u.name, u.email FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s",
            (landlord_id,)
        )
        landlord = cur.fetchone()
        if not landlord:
            return None
        current_month = datetime.utcnow().strftime("%Y-%m")
        cur.execute(
            "SELECT * FROM properties WHERE landlord_id=%s AND COALESCE(status,'approved')='approved' ORDER BY name",
            (landlord_id,)
        )
        properties = cur.fetchall() or []
        rooms_by_prop = {}
        for prop in properties:
            cur.execute(
                """SELECT room_number, max_beds,
                          COALESCE(price_per_bed, rent_amount, 0) as price_per_bed,
                          COALESCE(occupied_beds, 0) as occupied_beds
                   FROM rooms WHERE property_id=%s ORDER BY room_number""",
                (prop['id'],)
            )
            rooms_by_prop[prop['id']] = cur.fetchall() or []
        cur.execute("""
            SELECT t.name, t.property_id, COALESCE(t.beds_taken, 1) as beds_taken,
                   r.room_number,
                   COALESCE(r.price_per_bed, r.rent_amount, 0) as price_per_bed,
                   COALESCE(rp.status, 'not_generated') as rent_status
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN rent_payments rp ON rp.tenant_id = t.id AND rp.month_year = %s
            WHERE t.landlord_id = %s
            ORDER BY t.name
        """, (current_month, landlord_id))
        all_tenants = cur.fetchall() or []
        tenants_by_prop = {}
        for t in all_tenants:
            tenants_by_prop.setdefault(t['property_id'], []).append(t)
        cur.execute("""
            SELECT t.name as tenant_name, rp.amount, rp.status, rp.paid_at
            FROM rent_payments rp
            JOIN tenants t ON rp.tenant_id = t.id
            WHERE rp.landlord_id = %s AND rp.month_year = %s
            ORDER BY t.name
        """, (landlord_id, current_month))
        rent_summary = cur.fetchall() or []
        total_rooms = sum(len(rooms_by_prop.get(p['id'], [])) for p in properties)
        total_tenants = len(all_tenants)
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND month_year=%s AND status='paid'",
            (landlord_id, current_month)
        )
        monthly_rev = float(scalar(cur) or 0)
    except Exception:
        _traceback.print_exc()
        return None
    finally:
        conn.close()

    biz = landlord['business_name'] or landlord['name'] or 'Landlord'
    gen_date = datetime.utcnow().strftime("%B %d, %Y")
    try:
        month_label = datetime.strptime(current_month, "%Y-%m").strftime("%B %Y")
    except Exception:
        month_label = current_month

    BLUE = colors.HexColor('#2563EB')
    ROW_ALT = colors.HexColor('#F8FAFC')

    def _ts():
        return [
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,0), 9),
            ('BACKGROUND', (0,0), (-1,0), BLUE),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,1), (-1,-1), 9),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, ROW_ALT]),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
            ('PADDING', (0,0), (-1,-1), 6),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        rightMargin=20*mm, leftMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story = []

    title_s = ParagraphStyle('le_title', fontName='Helvetica-Bold', fontSize=16,
        textColor=colors.HexColor('#1E293B'))
    shdr_s = ParagraphStyle('le_shdr', fontName='Helvetica-Bold', fontSize=12, textColor=BLUE)
    small_s = ParagraphStyle('le_small', fontName='Helvetica', fontSize=8,
        textColor=colors.HexColor('#6B7280'))
    footer_s = ParagraphStyle('le_footer', fontName='Helvetica', fontSize=8,
        textColor=colors.HexColor('#9CA3AF'), alignment=1)

    pdf_header(story, "Smart Property Management Platform")
    story.append(HRFlowable(width="100%", thickness=2, color=BLUE))
    story.append(Spacer(1, 8))
    story.append(Paragraph(f'Property Report — {biz}', title_s))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f'Generated: {gen_date}', small_s))
    story.append(Spacer(1, 8))

    # Summary stats [120+121+121+120=482pt]
    summary_data = [
        ['Properties', 'Rooms', 'Tenants', 'Monthly Revenue'],
        [str(len(properties)), str(total_rooms), str(total_tenants), f'Rs {int(monthly_rev):,}'],
    ]
    s_tbl = Table(summary_data, colWidths=[120, 121, 121, 120], repeatRows=1)
    s_tbl.setStyle(TableStyle(_ts() + [('ALIGN', (0,0), (-1,-1), 'CENTER'), ('FONTSIZE', (0,1), (-1,1), 11)]))
    story.append(s_tbl)
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E2E8F0')))
    story.append(Spacer(1, 16))

    # Per-property sections
    for prop in properties:
        ptype = (prop['property_type'] or '').replace('_', ' ').title()
        story.append(Paragraph(prop['name'] or 'Unnamed Property', shdr_s))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            f'<font color="#6B7280" size="8">{ptype} · {prop["address"] or "No address"}</font>',
            styles['Normal']))
        story.append(Spacer(1, 8))

        # Room table [80+80+80+122+120=482pt]
        rooms = rooms_by_prop.get(prop['id'], [])
        if rooms:
            r_data = [['Room', 'Beds', 'Occupied', 'Price/Bed', 'Monthly Revenue']] + [
                [r['room_number'] or '—', str(r['max_beds'] or 1),
                 str(r['occupied_beds']),
                 f'Rs {int(r["price_per_bed"] or 0):,}',
                 f'Rs {int((r["price_per_bed"] or 0) * (r["occupied_beds"] or 0)):,}']
                for r in rooms
            ]
            r_tbl = Table(r_data, colWidths=[80, 80, 80, 122, 120], repeatRows=1)
            r_tbl.setStyle(TableStyle(_ts()))
            story.append(r_tbl)
            story.append(Spacer(1, 8))

        # Tenant table [160+78+72+102+70=482pt]
        prop_tenants = tenants_by_prop.get(prop['id'], [])
        if prop_tenants:
            t_data = [['Tenant Name', 'Room', 'Beds', 'Rent Due', 'Status']] + [
                [t['name'] or '—',
                 t['room_number'] or '—',
                 str(t['beds_taken']),
                 f'Rs {int((t["price_per_bed"] or 0) * (t["beds_taken"] or 1)):,}',
                 (t['rent_status'] or '').replace('_', ' ').title()]
                for t in prop_tenants
            ]
            t_tbl = Table(t_data, colWidths=[160, 78, 72, 102, 70], repeatRows=1)
            t_tbl.setStyle(TableStyle(_ts()))
            story.append(t_tbl)

        story.append(Spacer(1, 16))
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#E5E7EB')))
        story.append(Spacer(1, 16))

    # Rent Summary section
    story.append(Paragraph(f'Rent Summary — {month_label}', shdr_s))
    story.append(Spacer(1, 8))
    if rent_summary:
        # [200+102+100+80=482pt]
        rs_data = [['Tenant', 'Amount', 'Status', 'Date']] + [
            [r['tenant_name'] or '—',
             f'Rs {int(r["amount"] or 0):,}',
             (r['status'] or '').replace('_', ' ').title(),
             (r['paid_at'] or '—')[:10]]
            for r in rent_summary
        ]
        rs_tbl = Table(rs_data, colWidths=[200, 102, 100, 80], repeatRows=1)
        rs_tbl.setStyle(TableStyle(_ts()))
        story.append(rs_tbl)
    else:
        story.append(Paragraph(
            f'<font color="#9CA3AF" size="8">No rent payments generated for {month_label}.</font>',
            styles['Normal']))

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E5E7EB')))
    story.append(Spacer(1, 8))
    story.append(Paragraph('Generated by RentEase — Smart Property Management Platform', footer_s))

    doc.build(story)
    buf.seek(0)
    return buf


def generate_admin_report_pdf():
    """Platform-wide admin report PDF."""
    if not HAS_REPORTLAB:
        return None

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) FROM landlords WHERE status='active' AND COALESCE(is_deleted,0)=0")
        total_landlords = scalar(cur)
        cur.execute("SELECT COUNT(*) FROM properties WHERE COALESCE(status,'approved')='approved'")
        total_properties = scalar(cur)
        cur.execute("SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE status='paid'")
        platform_recv = float(scalar(cur) or 0)
        cur.execute("SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE status='pending'")
        platform_pend = float(scalar(cur) or 0)
        cur.execute("""
            SELECT month_year,
                   COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) as received,
                   COALESCE(SUM(CASE WHEN status!='paid' THEN amount ELSE 0 END), 0) as pending,
                   COALESCE(SUM(amount), 0) as total
            FROM platform_payments
            GROUP BY month_year
            HAVING COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0) > 0
                OR COALESCE(SUM(CASE WHEN status!='paid' THEN amount ELSE 0 END), 0) > 0
            ORDER BY month_year ASC
        """)
        monthly_fees = cur.fetchall()
        cur.execute("""
            SELECT u.name as landlord_name,
                   COUNT(DISTINCT pr.id) as property_count,
                   COUNT(DISTINCT t.id) as tenant_count,
                   COALESCE(SUM(CASE WHEN pp.status='paid' THEN pp.amount ELSE 0 END), 0) as fees_paid,
                   COALESCE(SUM(CASE WHEN pp.status!='paid' THEN pp.amount ELSE 0 END), 0) as fees_pending,
                   MAX(CASE WHEN pp.status='paid' THEN pp.paid_at END) as last_payment
            FROM landlords l
            JOIN users u ON l.user_id = u.id
            LEFT JOIN properties pr ON pr.landlord_id = l.id
                AND COALESCE(pr.status,'approved')='approved'
            LEFT JOIN tenants t ON t.landlord_id = l.id AND t.is_active = 1
            LEFT JOIN platform_payments pp ON pp.landlord_id = l.id
            WHERE COALESCE(l.is_deleted, 0) = 0
            GROUP BY l.id, u.name
            ORDER BY u.name
        """)
        landlord_breakdown = cur.fetchall()
    finally:
        conn.close()

    gen_date = datetime.utcnow().strftime("%B %d, %Y")

    BLUE = colors.HexColor('#2563EB')
    ROW_ALT = colors.HexColor('#F8FAFC')

    def _ts():
        return [
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,0), 9),
            ('BACKGROUND', (0,0), (-1,0), BLUE),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,1), (-1,-1), 'Helvetica'),
            ('FONTSIZE', (0,1), (-1,-1), 9),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, ROW_ALT]),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
            ('PADDING', (0,0), (-1,-1), 6),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        rightMargin=20*mm, leftMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)
    styles = getSampleStyleSheet()
    story = []

    title_s = ParagraphStyle('ar_title', fontName='Helvetica-Bold', fontSize=16,
        textColor=colors.HexColor('#1E293B'))
    shdr_s = ParagraphStyle('ar_shdr', fontName='Helvetica-Bold', fontSize=12, textColor=BLUE)
    small_s = ParagraphStyle('ar_small', fontName='Helvetica', fontSize=8,
        textColor=colors.HexColor('#6B7280'))
    footer_s = ParagraphStyle('ar_footer', fontName='Helvetica', fontSize=8,
        textColor=colors.HexColor('#9CA3AF'), alignment=1)

    pdf_header(story, "Smart Property Management Platform")
    story.append(HRFlowable(width="100%", thickness=2, color=BLUE))
    story.append(Spacer(1, 8))
    story.append(Paragraph('Platform Revenue Report', title_s))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f'Generated: {gen_date}', small_s))
    story.append(Spacer(1, 8))

    # Summary stats [120+122+120+120=482pt]
    summary_data = [
        ['Total Received', 'Pending', 'Active Landlords', 'Total Properties'],
        [f'Rs {int(platform_recv):,}', f'Rs {int(platform_pend):,}',
         str(total_landlords), str(total_properties)],
    ]
    s_tbl = Table(summary_data, colWidths=[120, 122, 120, 120], repeatRows=1)
    s_tbl.setStyle(TableStyle(_ts() + [('ALIGN', (0,0), (-1,-1), 'CENTER'), ('FONTSIZE', (0,1), (-1,1), 11)]))
    story.append(s_tbl)
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E2E8F0')))
    story.append(Spacer(1, 16))

    # Monthly Revenue [120+121+121+120=482pt]
    story.append(Paragraph('Monthly Revenue', shdr_s))
    story.append(Spacer(1, 8))
    if monthly_fees:
        mf_data = [['Month', 'Received', 'Pending', 'Total']] + [
            [mf['month_year'] or '—',
             f'Rs {int(mf["received"] or 0):,}',
             f'Rs {int(mf["pending"] or 0):,}',
             f'Rs {int(mf["total"] or 0):,}']
            for mf in monthly_fees
        ]
        mf_tbl = Table(mf_data, colWidths=[120, 121, 121, 120], repeatRows=1)
        mf_tbl.setStyle(TableStyle(_ts()))
        story.append(mf_tbl)
    else:
        story.append(Paragraph(
            '<font color="#9CA3AF" size="8">No revenue data yet.</font>', styles['Normal']))
    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E2E8F0')))
    story.append(Spacer(1, 16))

    # Landlord Breakdown [140+60+60+82+80+60=482pt]
    story.append(Paragraph('Landlord Breakdown', shdr_s))
    story.append(Spacer(1, 8))
    if landlord_breakdown:
        lb_data = [['Landlord', 'Properties', 'Tenants', 'Fees Paid', 'Fees Pending', 'Last Payment']] + [
            [lb['landlord_name'] or '—',
             str(lb['property_count'] or 0),
             str(lb['tenant_count'] or 0),
             f'Rs {int(lb["fees_paid"] or 0):,}',
             f'Rs {int(lb["fees_pending"] or 0):,}',
             (lb['last_payment'] or '—')[:10]]
            for lb in landlord_breakdown
        ]
        lb_tbl = Table(lb_data, colWidths=[140, 60, 60, 82, 80, 60], repeatRows=1)
        lb_tbl.setStyle(TableStyle(_ts()))
        story.append(lb_tbl)
    else:
        story.append(Paragraph(
            '<font color="#9CA3AF" size="8">No landlord data yet.</font>', styles['Normal']))

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#E5E7EB')))
    story.append(Spacer(1, 8))
    story.append(Paragraph('Generated by RentEase — Smart Property Management Platform', footer_s))

    doc.build(story)
    buf.seek(0)
    return buf


# ── Table creation ────────────────────────────────────────────────────────────

def create_tables():
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'tenant',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS landlords (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        business_name TEXT NOT NULL,
        phone TEXT,
        subscription_status TEXT NOT NULL DEFAULT 'trial',
        subscription_expiry TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        is_approved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS properties (
        id SERIAL PRIMARY KEY,
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        name TEXT NOT NULL,
        address TEXT,
        property_type TEXT NOT NULL DEFAULT 'hostel',
        total_rooms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id),
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        room_number TEXT NOT NULL,
        floor INTEGER DEFAULT 0,
        capacity INTEGER NOT NULL DEFAULT 1,
        rent_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'vacant',
        unit_type TEXT NOT NULL DEFAULT 'room',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        room_id INTEGER REFERENCES rooms(id),
        property_id INTEGER REFERENCES properties(id),
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        cnic TEXT,
        emergency_contact TEXT,
        move_in_date TEXT,
        move_out_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rent_payments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        amount REAL NOT NULL,
        month_year TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        due_date TEXT,
        paid_at TEXT,
        receipt_image TEXT,
        notes TEXT,
        verified_by INTEGER,
        verified_at TEXT,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS maintenance_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        photo TEXT,
        created_at TEXT NOT NULL DEFAULT NOW(),
        resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS complaints (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        landlord_response TEXT,
        created_at TEXT NOT NULL DEFAULT NOW(),
        resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notices (
        id SERIAL PRIMARY KEY,
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        property_id INTEGER REFERENCES properties(id),
        title TEXT NOT NULL,
        message TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        plan TEXT NOT NULL DEFAULT 'trial',
        amount REAL NOT NULL DEFAULT 0,
        start_date TEXT,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS platform_payments (
        id SERIAL PRIMARY KEY,
        landlord_id INTEGER NOT NULL REFERENCES landlords(id),
        amount REAL NOT NULL,
        month_year TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        due_date TEXT,
        paid_at TEXT,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_notifications (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_notifications (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_notice_reads (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        notice_id INTEGER NOT NULL,
        read_at TEXT DEFAULT NOW(),
        UNIQUE(tenant_id, notice_id)
    );

    CREATE TABLE IF NOT EXISTS tenant_audit_log (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        cnic TEXT,
        landlord_id INTEGER,
        room_id INTEGER,
        property_id INTEGER,
        move_in_date TEXT,
        deleted_at TEXT NOT NULL DEFAULT NOW(),
        deleted_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS listings (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL,
        landlord_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (property_id) REFERENCES properties(id),
        FOREIGN KEY (landlord_id) REFERENCES landlords(id)
    );

    CREATE TABLE IF NOT EXISTS listing_photos (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL,
        photo_url TEXT NOT NULL,
        is_primary INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (listing_id) REFERENCES listings(id)
    );

    CREATE TABLE IF NOT EXISTS listing_inquiries (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        message TEXT,
        contacted INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (listing_id) REFERENCES listings(id)
    );
    """)
    conn.commit()
    conn.close()


def column_exists(cur, table, column):
    cur.execute(
        """SELECT column_name FROM information_schema.columns
           WHERE table_name=%s AND column_name=%s""",
        (table, column),
    )
    return cur.fetchone() is not None


def migrate_tables():
    """Add new columns to existing tables — safe to run on every startup."""
    conn = get_db_connection()
    cur = conn.cursor()
    migrations = [
        ("landlords", "status", "ALTER TABLE landlords ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"),
        ("landlords", "is_approved", "ALTER TABLE landlords ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 0"),
        ("rent_payments", "verified_by", "ALTER TABLE rent_payments ADD COLUMN verified_by INTEGER"),
        ("rent_payments", "verified_at", "ALTER TABLE rent_payments ADD COLUMN verified_at TEXT"),
        ("landlords", "monthly_fee", "ALTER TABLE landlords ADD COLUMN monthly_fee REAL NOT NULL DEFAULT 0"),
        ("landlords", "is_deleted", "ALTER TABLE landlords ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0"),
        ("landlords", "deleted_at", "ALTER TABLE landlords ADD COLUMN deleted_at TEXT"),
        ("rooms", "unit_type", "ALTER TABLE rooms ADD COLUMN unit_type TEXT NOT NULL DEFAULT 'room'"),
        # Bed-based system
        ("rooms", "max_beds", "ALTER TABLE rooms ADD COLUMN max_beds INTEGER NOT NULL DEFAULT 1"),
        ("rooms", "price_per_bed", "ALTER TABLE rooms ADD COLUMN price_per_bed REAL NOT NULL DEFAULT 0"),
        ("rooms", "occupied_beds", "ALTER TABLE rooms ADD COLUMN occupied_beds INTEGER NOT NULL DEFAULT 0"),
        ("tenants", "beds_taken", "ALTER TABLE tenants ADD COLUMN beds_taken INTEGER NOT NULL DEFAULT 1"),
        # Property approval + new categories
        ("properties", "status", "ALTER TABLE properties ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'"),
        ("properties", "category", "ALTER TABLE properties ADD COLUMN category TEXT"),
        # Complaint photo
        ("complaints", "photo_url", "ALTER TABLE complaints ADD COLUMN photo_url TEXT"),
        # Tenant deactivation tracking
        ("tenants", "deactivated_by_landlord", "ALTER TABLE tenants ADD COLUMN deactivated_by_landlord INTEGER NOT NULL DEFAULT 0"),
        # Landlord CNIC
        ("landlords", "cnic", "ALTER TABLE landlords ADD COLUMN cnic TEXT"),
        # Property sub_type (whole/individual for house)
        ("properties", "sub_type", "ALTER TABLE properties ADD COLUMN sub_type TEXT"),
        ("maintenance_requests", "notes", "ALTER TABLE maintenance_requests ADD COLUMN notes TEXT DEFAULT NULL"),
        ("admin_notifications", "user_id", "ALTER TABLE admin_notifications ADD COLUMN user_id INTEGER DEFAULT NULL"),
        ("complaints", "priority", "ALTER TABLE complaints ADD COLUMN priority TEXT DEFAULT 'medium'"),
        ("notices", "priority", "ALTER TABLE notices ADD COLUMN priority TEXT DEFAULT 'normal'"),
        ("rent_payments", "receipt_pdf_path", "ALTER TABLE rent_payments ADD COLUMN receipt_pdf_path TEXT"),
        ("rent_payments", "late_fee", "ALTER TABLE rent_payments ADD COLUMN late_fee REAL NOT NULL DEFAULT 0"),
        ("rent_payments", "total_amount", "ALTER TABLE rent_payments ADD COLUMN total_amount REAL"),
        ("rent_payments", "late_fee_applied", "ALTER TABLE rent_payments ADD COLUMN late_fee_applied INTEGER NOT NULL DEFAULT 0"),
        ("rent_payments", "overdue_notified", "ALTER TABLE rent_payments ADD COLUMN overdue_notified INTEGER NOT NULL DEFAULT 0"),
        ("tenants", "late_fee_percentage", "ALTER TABLE tenants ADD COLUMN late_fee_percentage REAL NOT NULL DEFAULT 0"),
        ("landlords", "late_fee_percentage", "ALTER TABLE landlords ADD COLUMN late_fee_percentage REAL NOT NULL DEFAULT 0"),
        ("platform_payments", "overdue_notified", "ALTER TABLE platform_payments ADD COLUMN overdue_notified INTEGER NOT NULL DEFAULT 0"),
        ("tenants", "rent_due_day", "ALTER TABLE tenants ADD COLUMN rent_due_day INTEGER DEFAULT 1"),
        ("listing_inquiries", "contacted", "ALTER TABLE listing_inquiries ADD COLUMN contacted INTEGER DEFAULT 0"),
    ]
    for table, column, sql in migrations:
        if not column_exists(cur, table, column):
            try:
                cur.execute(sql)
                conn.commit()
            except Exception:
                conn.rollback()
    # Sync new columns from old data (safe to run repeatedly)
    try:
        cur.execute("UPDATE rooms SET max_beds=capacity WHERE max_beds=1 AND capacity>1")
        cur.execute("UPDATE rooms SET price_per_bed=rent_amount WHERE price_per_bed=0 AND rent_amount>0")
        cur.execute("UPDATE properties SET category=property_type WHERE category IS NULL")
        conn.commit()
    except Exception:
        conn.rollback()
    # Migrate old category values to new naming (hostel_room→hostel, whole_house/house_room→house)
    try:
        cur.execute("UPDATE properties SET sub_type='whole' WHERE sub_type IS NULL AND (category='whole_house' OR property_type='whole_house')")
        cur.execute("UPDATE properties SET sub_type='individual' WHERE sub_type IS NULL AND (category='house_room' OR property_type='house_room')")
        cur.execute("UPDATE properties SET category='hostel', property_type='hostel' WHERE category='hostel_room' OR property_type='hostel_room'")
        cur.execute("UPDATE properties SET category='house', property_type='house' WHERE category IN ('whole_house','house_room') OR property_type IN ('whole_house','house_room')")
        cur.execute("UPDATE rooms SET price_per_bed=CAST(price_per_bed AS INTEGER) WHERE price_per_bed != CAST(price_per_bed AS INTEGER)")
        conn.commit()
    except Exception:
        conn.rollback()
    conn.close()


# ── Seed data ─────────────────────────────────────────────────────────────────

def _make_landlord(cur, now, email, password, name, business, phone, cnic, monthly_fee):
    cur.execute(
        "INSERT INTO users (name,email,password_hash,role,is_active,created_at) VALUES (%s,%s,%s,%s,1,%s) RETURNING id",
        (name, email, hash_password(password), "landlord", now),
    )
    uid = cur.fetchone()["id"]
    cur.execute(
        """INSERT INTO landlords (user_id,business_name,phone,cnic,status,is_approved,monthly_fee,created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (uid, business, phone, cnic, "active", 1, monthly_fee, now),
    )
    return cur.fetchone()["id"]


def _make_property(cur, now, lid, name, address, category, rooms):
    # rooms = list of (room_number, max_beds, price_per_bed)
    # Map old category names to new ones
    cat_map = {"hostel_room": "hostel", "whole_house": "house", "house_room": "house"}
    sub_map = {"whole_house": "whole", "house_room": "individual"}
    new_cat = cat_map.get(category, category)
    sub_type = sub_map.get(category, None)
    cur.execute(
        """INSERT INTO properties (landlord_id,name,address,property_type,category,sub_type,total_rooms,status,created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (lid, name, address, new_cat, new_cat, sub_type, len(rooms), "approved", now),
    )
    pid = cur.fetchone()["id"]
    for (rnum, beds, ppb) in rooms:
        ppb = int(ppb) if ppb else 0
        cur.execute(
            """INSERT INTO rooms (property_id,landlord_id,room_number,floor,capacity,rent_amount,
               max_beds,price_per_bed,occupied_beds,status,unit_type,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (pid, lid, rnum, 0, beds, ppb, beds, ppb, 0, "vacant", new_cat, now),
        )
    return pid


def _make_tenant(cur, now, lid, email, password, name):
    cur.execute(
        "INSERT INTO users (name,email,password_hash,role,is_active,created_at) VALUES (%s,%s,%s,%s,1,%s) RETURNING id",
        (name, email, hash_password(password), "tenant", now),
    )
    uid = cur.fetchone()["id"]
    cur.execute(
        """INSERT INTO tenants (user_id,landlord_id,name,email,is_active,created_at)
           VALUES (%s,%s,%s,%s,1,%s) RETURNING id""",
        (uid, lid, name, email, now),
    )
    return cur.fetchone()["id"]


def seed_data():
    import traceback
    try:
        print("[SEED] Starting seed data creation...")
        conn = get_db_connection()
        cur = conn.cursor()
        now = datetime.utcnow().isoformat()

        # Always ensure admin exists
        cur.execute("SELECT id FROM users WHERE email='admin@rentease.com'")
        if not cur.fetchone():
            cur.execute(
                "INSERT INTO users (name,email,password_hash,role,is_active,created_at) VALUES (%s,%s,%s,%s,1,%s)",
                ("Super Admin", "admin@rentease.com", hash_password("admin123"), "superadmin", now),
            )
            print("[SEED] Created admin user")

        # ── LANDLORD 1: Hussain Hostels ───────────────────────────────────────
        l1 = _make_landlord(cur, now, "landlord1@gmail.com", "Land1pass",
                            "Muhammad Hussain", "Hussain Hostels", "0301-1234567", "35202-1234567-1", 3000)
        _make_property(cur, now, l1, "Hostel Block A", "GIKI Topi", "hostel_room",
                       [("A1", 1, 5000), ("A2", 1, 5000)])
        _make_property(cur, now, l1, "Hostel Block B", "GIKI Topi", "hostel_room",
                       [("B1", 1, 5500), ("B2", 1, 5500)])
        _make_property(cur, now, l1, "Hostel Block C", "GIKI Topi", "hostel_room",
                       [("C1", 1, 6000), ("C2", 1, 6000)])
        _make_property(cur, now, l1, "City Apartments", "Peshawar Road", "apartment",
                       [("101", 2, 8000), ("102", 2, 8000)])
        _make_property(cur, now, l1, "Green House", "DHA Islamabad", "house_room",
                       [("Room 1", 2, 7000), ("Room 2", 2, 7000), ("Room 3", 2, 7000),
                        ("Room 4", 2, 7000), ("Room 5", 2, 7000)])
        print("[SEED] Landlord 1 properties created")
        for em, pw, nm in [
            ("tenant1@gmail.com", "Ten1pass", "Ali Hassan"),
            ("tenant2@gmail.com", "Ten2pass", "Sara Khan"),
            ("tenant3@gmail.com", "Ten3pass", "Omar Malik"),
            ("tenant4@gmail.com", "Ten4pass", "Fatima Raza"),
            ("tenant5@gmail.com", "Ten5pass", "Zain Ahmed"),
        ]:
            _make_tenant(cur, now, l1, em, pw, nm)
        print("[SEED] Landlord 1 tenants created")

        # ── LANDLORD 2: Solo Rooms ────────────────────────────────────────────
        l2 = _make_landlord(cur, now, "landlord2@gmail.com", "Land2pass",
                            "Ahmed Solo", "Solo Rooms", "0302-2345678", "35202-2345678-2", 3000)
        _make_property(cur, now, l2, "Solo Hostel", "Rawalpindi", "hostel_room",
                       [("Room 1", 1, 4000), ("Room 2", 1, 4000),
                        ("Room 3", 1, 4000), ("Room 4", 1, 4000)])
        print("[SEED] Landlord 2 properties created")
        for em, pw, nm in [
            ("tenant6@gmail.com", "Ten6pass", "Hina Baig"),
            ("tenant7@gmail.com", "Ten7pass", "Bilal Chaudhry"),
            ("tenant8@gmail.com", "Ten8pass", "Nadia Qureshi"),
            ("tenant9@gmail.com", "Ten9pass", "Usman Shah"),
        ]:
            _make_tenant(cur, now, l2, em, pw, nm)
        print("[SEED] Landlord 2 tenants created")

        # ── LANDLORD 3: Premium Properties ───────────────────────────────────
        l3 = _make_landlord(cur, now, "landlord3@gmail.com", "Land3pass",
                            "Kamran Premium", "Premium Properties", "0303-3456789", "35202-3456789-3", 3000)
        _make_property(cur, now, l3, "Gulberg House 1", "Gulberg Lahore", "whole_house",
                       [("Whole House", 1, 50000)])
        _make_property(cur, now, l3, "Gulberg House 2", "Gulberg Lahore", "whole_house",
                       [("Whole House", 1, 45000)])
        _make_property(cur, now, l3, "Gulberg House 3", "Gulberg Lahore", "whole_house",
                       [("Whole House", 1, 55000)])
        _make_property(cur, now, l3, "DHA Villa", "DHA Lahore", "house_room",
                       [("Room 1", 2, 15000), ("Room 2", 2, 15000),
                        ("Room 3", 2, 15000), ("Room 4", 2, 15000)])
        print("[SEED] Landlord 3 properties created")
        for em, pw, nm in [
            ("tenant10@gmail.com", "Ten10pass", "Ayesha Tariq"),
            ("tenant11@gmail.com", "Ten11pass", "Kamran Mirza"),
            ("tenant12@gmail.com", "Ten12pass", "Sana Javed"),
            ("tenant13@gmail.com", "Ten13pass", "Rahul Ahmed"),
        ]:
            _make_tenant(cur, now, l3, em, pw, nm)
        print("[SEED] Landlord 3 tenants created")

        conn.commit()
        conn.close()

        print("\n" + "="*60)
        print("[SEED] Done! All seed data created.")
        print("="*60)
        print("ADMIN:      admin@rentease.com       / admin123")
        print("LANDLORD 1: landlord1@gmail.com      / Land1pass  (Hussain Hostels)")
        print("LANDLORD 2: landlord2@gmail.com      / Land2pass  (Solo Rooms)")
        print("LANDLORD 3: landlord3@gmail.com      / Land3pass  (Premium Properties)")
        print("TENANTS:    tenant1@gmail.com         / Ten1pass   (Ali Hassan)")
        print("            tenant2@gmail.com         / Ten2pass   (Sara Khan)")
        print("            tenant3@gmail.com         / Ten3pass   (Omar Malik)")
        print("            tenant4@gmail.com         / Ten4pass   (Fatima Raza)")
        print("            tenant5@gmail.com         / Ten5pass   (Zain Ahmed)")
        print("            tenant6@gmail.com         / Ten6pass   (Hina Baig)")
        print("            tenant7@gmail.com         / Ten7pass   (Bilal Chaudhry)")
        print("            tenant8@gmail.com         / Ten8pass   (Nadia Qureshi)")
        print("            tenant9@gmail.com         / Ten9pass   (Usman Shah)")
        print("            tenant10@gmail.com        / Ten10pass  (Ayesha Tariq)")
        print("            tenant11@gmail.com        / Ten11pass  (Kamran Mirza)")
        print("            tenant12@gmail.com        / Ten12pass  (Sana Javed)")
        print("            tenant13@gmail.com        / Ten13pass  (Rahul Ahmed)")
        print("="*60 + "\n")

    except Exception as e:
        print(f"[SEED ERROR] Seed failed: {e}")
        traceback.print_exc()


FLAG_FILE = "cleaned.flag"


def clean_all_data():
    """Wipe every table except admin@rentease.com. Runs once, then stops via flag file."""
    if os.path.exists(FLAG_FILE):
        return
    conn = get_db_connection()
    cur = conn.cursor()
    for table in [
        'listing_inquiries', 'listing_photos', 'listings',
        'tenant_audit_log', 'tenant_notifications', 'admin_notifications',
        'notifications', 'platform_payments', 'rent_payments',
        'maintenance_requests', 'complaints', 'notices', 'tenant_notice_reads',
        'tenants', 'rooms', 'properties', 'landlords',
    ]:
        try:
            cur.execute(f"DELETE FROM {table}")
        except Exception:
            pass
    try:
        cur.execute("DELETE FROM users WHERE role != 'superadmin'")
    except Exception:
        pass
    conn.commit()
    conn.close()
    with open(FLAG_FILE, 'w') as f:
        f.write('cleaned')
    print("[STARTUP] Database cleaned — only admin remains")


# ── Startup ───────────────────────────────────────────────────────────────────

@app.middleware("http")
async def log_requests(request, call_next):
    print(f"REQUEST: {request.method} {request.url.path} (from {request.headers.get('origin', 'unknown')})")
    response = await call_next(request)
    print(f"RESPONSE: {request.method} {request.url.path} -> {response.status_code}")
    return response


@app.on_event("startup")
def startup():
    try:
        _conn = get_db_connection()
        print("[STARTUP] PostgreSQL connected successfully")
        _conn.close()
    except Exception as e:
        print(f"[STARTUP] Database connection FAILED: {e}")
        import traceback as _tb
        _tb.print_exc()

    create_tables()
    migrate_tables()
    clean_all_data()  # wipe stale data if flag absent; creates flag after running

    # After potential cleanup, check if seed data is needed
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT COUNT(*) as c FROM landlords WHERE COALESCE(is_deleted,0)=0"
        )
        landlord_count = cur.fetchone()["c"]
    except Exception:
        landlord_count = 0
    finally:
        conn.close()

    if landlord_count == 0:
        print(f"[STARTUP] No landlords found — running seed data...")
        seed_data()
    else:
        print(f"[STARTUP] Found {landlord_count} landlord(s) — skipping seed")

    # Reset any overdue rent payments back to pending
    conn2 = get_db_connection()
    try:
        cur2 = conn2.cursor()
        cur2.execute("UPDATE rent_payments SET status='pending' WHERE status='overdue'")
        conn2.commit()
    finally:
        conn2.close()

    # Start auto-rent generation scheduler (runs daily at 06:00)
    if HAS_SCHEDULER:
        _scheduler = BackgroundScheduler()
        _scheduler.add_job(auto_generate_rent, 'cron', hour=6, minute=0)
        _scheduler.start()
        print("[SCHEDULER] Auto-rent generation started (daily at 06:00)")
    else:
        print("[SCHEDULER] APScheduler not available — auto-rent disabled")


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    business_name: str
    phone: Optional[str] = None
    cnic: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/auth/register")
def register(req: RegisterRequest):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE email=%s AND is_active=1", (req.email,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Email already registered")

        now = datetime.utcnow().isoformat()
        trial_end = (datetime.utcnow() + timedelta(days=30)).date().isoformat()

        cur.execute(
            "INSERT INTO users (name,email,password_hash,role,is_active,created_at) VALUES (%s,%s,%s,%s,1,%s) RETURNING id",
            (req.name, req.email, hash_password(req.password), "landlord", now),
        )
        user_id = cur.fetchone()["id"]

        cur.execute(
            """INSERT INTO landlords
               (user_id,business_name,phone,cnic,status,is_approved,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (user_id, req.business_name, req.phone, req.cnic, "active", 1, now),
        )
        create_admin_notification(cur, "landlord_register", f"New landlord · {req.name} · {req.email}", "/admin/landlords")
        conn.commit()
        return {"message": "Account created! You can now sign in."}
    finally:
        conn.close()


@app.post("/auth/login")
def login(req: LoginRequest):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE email=%s", (req.email,))
        user = cur.fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if not user["is_active"]:
            if user["role"] == "tenant":
                cur.execute(
                    "SELECT landlord_id, deactivated_by_landlord FROM tenants WHERE user_id=%s", (user["id"],)
                )
                tenant_row = cur.fetchone()
                if tenant_row and tenant_row["deactivated_by_landlord"]:
                    raise HTTPException(status_code=403, detail="Your account is temporarily inactive. Contact your landlord.")
            raise HTTPException(status_code=403, detail="Account has been deactivated")

        landlord_id = None
        if user["role"] == "landlord":
            cur.execute("SELECT id, status, COALESCE(is_deleted,0) as is_deleted FROM landlords WHERE user_id=%s", (user["id"],))
            row = cur.fetchone()
            if row:
                if row["is_deleted"]:
                    raise HTTPException(status_code=401, detail="This account has been deleted")
                landlord_status = row["status"]
                if landlord_status == "pending":
                    raise HTTPException(status_code=403, detail="Your account is pending admin approval")
                if landlord_status in ("inactive", "rejected", "deleted"):
                    raise HTTPException(status_code=403, detail="Your account has been deactivated. Contact admin.")
                landlord_id = row["id"]
        elif user["role"] == "tenant":
            cur.execute("SELECT landlord_id FROM tenants WHERE user_id=%s AND is_active=1", (user["id"],))
            row = cur.fetchone()
            landlord_id = row["landlord_id"] if row else None

        token = create_token(user["id"], user["role"], landlord_id)
        return {"token": token, "role": user["role"], "name": user["name"], "email": user["email"]}
    finally:
        conn.close()


class ForgotPasswordRequest(BaseModel):
    email: str


@app.post("/auth/forgot-password")
def forgot_password(body: ForgotPasswordRequest):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, name, email, role FROM users WHERE LOWER(email)=LOWER(%s) AND is_active=1",
            (body.email.strip(),)
        )
        user_row = cur.fetchone()
        if user_row:
            link = ""
            if user_row["role"] == "landlord":
                cur.execute("SELECT id FROM landlords WHERE user_id=%s", (user_row["id"],))
                landlord = cur.fetchone()
                if landlord:
                    link = f"/admin/landlords/{landlord['id']}"
            elif user_row["role"] == "tenant":
                cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user_row["id"],))
                tenant = cur.fetchone()
                if tenant:
                    link = f"/admin/tenants?id={tenant['id']}"
            create_admin_notification(
                cur, "password_reset",
                f"{user_row['name']} ({user_row['email']}) requested a password reset.",
                link,
                user_id=user_row["id"],
            )
            conn.commit()
        return {"message": "If your email is registered, an admin will be notified to reset your password."}
    finally:
        conn.close()


@app.get("/auth/me")
def me(user=Depends(current_user)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id,name,email,role,is_active,created_at FROM users WHERE id=%s", (user["sub"],)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        return dict(row)
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# SUPERADMIN ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/admin/stats")
def admin_stats(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) as c FROM landlords WHERE status='active' AND COALESCE(is_deleted,0)=0")
        landlords = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM properties WHERE COALESCE(status,'approved')='approved'")
        properties = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM tenants WHERE is_active=1")
        tenants = cur.fetchone()["c"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM rent_payments WHERE status='paid'"
        )
        revenue = cur.fetchone()["s"]
        cur.execute(
            "SELECT COUNT(*) as c FROM landlords WHERE status='pending' AND COALESCE(is_deleted,0)=0"
        )
        pending_landlords = cur.fetchone()["c"]
        cur.execute(
            "SELECT COUNT(*) as c FROM properties WHERE status='pending_approval'"
        )
        pending_properties = cur.fetchone()["c"]
        current_month = datetime.utcnow().strftime("%Y-%m")
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM platform_payments WHERE status='paid' AND month_year=%s",
            (current_month,),
        )
        platform_revenue_this_month = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM platform_payments WHERE status IN ('pending','pending_verification')"
        )
        total_pending_fees = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM platform_payments WHERE status='paid'"
        )
        total_received = cur.fetchone()["s"]
        return {
            "landlords": landlords,
            "properties": properties,
            "tenants": tenants,
            "revenue": revenue,
            "pending_landlords": pending_landlords,
            "pending_properties": pending_properties,
            "platform_revenue_this_month": float(platform_revenue_this_month),
            "total_pending_fees": float(total_pending_fees),
            "total_received": float(total_received),
        }
    finally:
        conn.close()


@app.get("/admin/history")
def admin_history(user=Depends(require_superadmin)):
    print("HIT: GET /admin/history")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.id, l.business_name, l.status,
                   COALESCE(l.monthly_fee, 0) as monthly_fee,
                   COALESCE(l.is_deleted, 0) as is_deleted,
                   l.deleted_at, l.created_at,
                   u.name, u.email,
                   COALESCE((SELECT SUM(amount) FROM platform_payments
                    WHERE landlord_id=l.id AND status='paid'), 0) as fees_paid,
                   COALESCE((SELECT COUNT(*) FROM properties
                    WHERE landlord_id=l.id), 0) as property_count,
                   COALESCE((SELECT COUNT(*) FROM tenants
                    WHERE landlord_id=l.id), 0) as tenant_count
            FROM landlords l
            JOIN users u ON l.user_id=u.id
            ORDER BY u.name ASC
        """)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[admin_history] ERROR: {e}")
        return []
    finally:
        conn.close()


@app.get("/admin/revenue")
def admin_revenue_v2(user=Depends(require_superadmin)):
    print("HIT: GET /admin/revenue")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT COALESCE(SUM(monthly_fee), 0) FROM landlords WHERE status='active' AND is_deleted=0 AND monthly_fee IS NOT NULL AND monthly_fee > 0"
        )
        expected = float(scalar(cur) or 0)
        try:
            cur.execute("SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE status='paid'")
            received = float(scalar(cur) or 0)
            cur.execute("SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE status='pending'")
            pending = float(scalar(cur) or 0)
        except Exception:
            received, pending = 0.0, 0.0
        current_month = datetime.utcnow().strftime("%Y-%m")
        try:
            cur.execute(
                "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE status='paid' AND month_year=%s",
                (current_month,)
            )
            monthly_rent_revenue = float(scalar(cur) or 0)
        except Exception:
            monthly_rent_revenue = 0.0
        try:
            cur.execute("""
                SELECT l.id, u.name, u.email,
                       COALESCE(l.monthly_fee,0) as monthly_fee, l.status,
                       COALESCE((SELECT SUM(amount) FROM platform_payments WHERE landlord_id=l.id AND status='paid'),0) as paid,
                       COALESCE((SELECT SUM(amount) FROM platform_payments WHERE landlord_id=l.id AND status='pending'),0) as pending_amount
                FROM landlords l JOIN users u ON l.user_id=u.id
                WHERE COALESCE(l.is_deleted,0)=0
                ORDER BY l.status, u.name ASC
            """)
            rows = cur.fetchall()
            breakdown = [dict(r) for r in rows]
        except Exception as e:
            print(f"[admin_revenue] breakdown error: {e}")
            breakdown = []
        return {
            "expected_monthly": expected,
            "total_received": received,
            "total_pending": pending,
            "monthly_rent_revenue": monthly_rent_revenue,
            "landlord_breakdown": breakdown,
        }
    except Exception as e:
        print(f"[admin_revenue] ERROR: {e}")
        return {"expected_monthly": 0.0, "total_received": 0.0, "total_pending": 0.0, "monthly_rent_revenue": 0.0, "landlord_breakdown": []}
    finally:
        conn.close()


@app.get("/admin/landlords")
def admin_landlords(user=Depends(require_superadmin)):
    print("HIT: GET /admin/landlords")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.id, l.business_name, l.phone, l.status,
                   COALESCE(l.monthly_fee, 0) as monthly_fee,
                   u.name, u.email, u.is_active,
                   (SELECT COUNT(*) FROM properties WHERE landlord_id=l.id) as property_count,
                   (SELECT COUNT(*) FROM tenants WHERE landlord_id=l.id) as tenant_count
            FROM landlords l JOIN users u ON l.user_id=u.id
            WHERE COALESCE(l.is_deleted, 0) = 0
            ORDER BY u.name ASC
        """)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/admin/landlords/{lid}/activate")
def activate_landlord(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT user_id FROM landlords WHERE id=%s", (lid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Landlord not found")
        cur.execute("UPDATE landlords SET status='active', is_approved=1 WHERE id=%s", (lid,))
        cur.execute("UPDATE users SET is_active=1 WHERE id=%s", (row["user_id"],))
        # Restore properties that were deactivated
        cur.execute("UPDATE properties SET status='approved' WHERE landlord_id=%s AND status='inactive'", (lid,))
        # Restore tenant user accounts that were deactivated by landlord deactivation
        cur.execute(
            "UPDATE users SET is_active=1 WHERE id IN (SELECT user_id FROM tenants WHERE landlord_id=%s AND user_id IS NOT NULL AND deactivated_by_landlord=1)",
            (lid,)
        )
        cur.execute("UPDATE tenants SET deactivated_by_landlord=0 WHERE landlord_id=%s", (lid,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.put("/admin/landlords/{lid}/deactivate")
def deactivate_landlord(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT user_id FROM landlords WHERE id=%s", (lid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Landlord not found")
        cur.execute("UPDATE landlords SET status='inactive' WHERE id=%s", (lid,))
        cur.execute("UPDATE users SET is_active=0 WHERE id=%s", (row["user_id"],))
        # Cascade: deactivate all properties
        cur.execute("UPDATE properties SET status='inactive' WHERE landlord_id=%s AND status != 'inactive'", (lid,))
        # Cascade: deactivate all tenant user accounts; mark them so we can restore them on re-activate
        cur.execute(
            "UPDATE tenants SET deactivated_by_landlord=1 WHERE landlord_id=%s AND is_active=1 AND user_id IS NOT NULL",
            (lid,)
        )
        cur.execute(
            "UPDATE users SET is_active=0 WHERE id IN (SELECT user_id FROM tenants WHERE landlord_id=%s AND user_id IS NOT NULL)",
            (lid,)
        )
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


class ApproveLandlordRequest(BaseModel):
    monthly_fee: float = 0.0


@app.put("/admin/landlords/{lid}/approve")
def approve_landlord(lid: int, body: ApproveLandlordRequest, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM landlords WHERE id=%s", (lid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Landlord not found")
        print(f"[approve_landlord] landlord_id={lid}, monthly_fee={body.monthly_fee}")
        cur.execute(
            "UPDATE landlords SET status='active', is_approved=1, monthly_fee=%s WHERE id=%s",
            (body.monthly_fee, lid),
        )
        cur.execute(
            "UPDATE users SET is_active=1 WHERE id=(SELECT user_id FROM landlords WHERE id=%s)", (lid,)
        )
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.put("/admin/landlords/{lid}/set-fee")
async def set_landlord_fee(
    lid: int,
    body: dict = Body(...),
    user=Depends(require_superadmin),
):
    fee = float(body.get("monthly_fee", 0))
    print(f"HIT: PUT /admin/landlords/{lid}/set-fee fee={fee}")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        print(f"[set-fee] Setting fee for landlord {lid} to {fee}")
        cur.execute("SELECT id FROM landlords WHERE id=%s", (lid,))
        row = cur.fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Landlord not found")
        cur.execute("UPDATE landlords SET monthly_fee=%s WHERE id=%s", (fee, lid))
        conn.commit()
        cur.execute("SELECT monthly_fee FROM landlords WHERE id=%s", (lid,))
        saved = cur.fetchone()
        print(f"[set-fee] Verified saved value: {saved['monthly_fee']}")
        conn.close()
        return {"monthly_fee": saved["monthly_fee"], "message": "Fee updated"}
    except HTTPException:
        conn.close()
        raise
    except Exception as e:
        conn.close()
        print(f"[set-fee] ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/landlords/{lid}/generate-platform-fee")
def generate_landlord_platform_fee(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM landlords WHERE id=%s AND COALESCE(is_deleted,0)=0", (lid,)
        )
        landlord = cur.fetchone()
        if not landlord:
            raise HTTPException(status_code=404, detail="Landlord not found")
        monthly_fee = landlord["monthly_fee"] or 0
        if monthly_fee <= 0:
            raise HTTPException(status_code=400, detail="Monthly fee not set for this landlord")
        month_year = datetime.utcnow().strftime("%Y-%m")
        cur.execute(
            "SELECT id FROM platform_payments WHERE landlord_id=%s AND month_year=%s", (lid, month_year)
        )
        if cur.fetchone():
            return {"message": f"Bill already exists for {month_year}", "created": False, "amount": monthly_fee}
        year, month = map(int, month_year.split("-"))
        next_m = month + 1 if month < 12 else 1
        next_y = year if month < 12 else year + 1
        now = datetime.utcnow().isoformat()
        cur.execute(
            "INSERT INTO platform_payments (landlord_id,amount,month_year,status,due_date,created_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (lid, monthly_fee, month_year, "pending", f"{next_y}-{next_m:02d}-01", now),
        )
        conn.commit()
        return {"message": f"Bill generated for {month_year}", "created": True, "amount": monthly_fee}
    finally:
        conn.close()


@app.get("/admin/landlords/{lid}/detail")
def admin_landlord_detail(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.*, u.name, u.email, u.is_active
            FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s
        """, (lid,))
        landlord = cur.fetchone()
        if not landlord:
            raise HTTPException(status_code=404, detail="Landlord not found")
        cur.execute("""
            SELECT p.id, p.name, p.address, p.property_type,
                   COALESCE(p.status, 'approved') as status,
                   COUNT(r.id) as total_rooms,
                   COALESCE(SUM(r.max_beds),0) as total_beds,
                   COALESCE(SUM(r.occupied_beds),0) as occupied_beds,
                   COALESCE(SUM(CASE WHEN r.max_beds IS NOT NULL THEN r.max_beds - r.occupied_beds ELSE 0 END),0) as vacant_beds
            FROM properties p LEFT JOIN rooms r ON r.property_id=p.id
            WHERE p.landlord_id=%s GROUP BY p.id
        """, (lid,))
        properties = cur.fetchall()
        cur.execute("""
            SELECT t.id, t.name, t.email, t.phone, t.move_in_date,
                   r.room_number, COALESCE(r.price_per_bed, r.rent_amount, 0) as rent_amount,
                   COALESCE(t.beds_taken, 1) as beds_taken,
                   p.name as property_name
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id=r.id
            LEFT JOIN properties p ON t.property_id=p.id
            WHERE t.landlord_id=%s ORDER BY t.created_at DESC
        """, (lid,))
        tenants = cur.fetchall()
        cur.execute(
            "SELECT * FROM platform_payments WHERE landlord_id=%s ORDER BY month_year DESC", (lid,)
        )
        payments = cur.fetchall()
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE landlord_id=%s AND status='paid'", (lid,)
        )
        total_paid = scalar(cur)
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE landlord_id=%s AND status IN ('pending','pending_verification')", (lid,)
        )
        outstanding = scalar(cur)
        return {
            "landlord": dict(landlord),
            "properties": [dict(p) for p in properties],
            "tenants": [dict(t) for t in tenants],
            "platform_payments": [dict(p) for p in payments],
            "total_paid": total_paid,
            "total_pending": outstanding,
        }
    finally:
        conn.close()


@app.get("/admin/properties")
def admin_all_properties(user=Depends(require_superadmin)):
    print("HIT: GET /admin/properties")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT p.id, p.name, p.address, p.property_type,
                   COALESCE(p.category, p.property_type) as category,
                   COALESCE(p.status, 'approved') as status,
                   u.name as landlord_name, l.id as landlord_id,
                   p.created_at,
                   COUNT(r.id) as total_rooms,
                   COALESCE(SUM(r.max_beds),0) as total_beds,
                   COALESCE(SUM(r.occupied_beds),0) as occupied_beds
            FROM properties p
            JOIN landlords l ON p.landlord_id = l.id
            JOIN users u ON l.user_id = u.id
            LEFT JOIN rooms r ON r.property_id = p.id
            WHERE COALESCE(l.is_deleted, 0) = 0
            GROUP BY p.id, u.name, l.id
            ORDER BY p.name ASC
        """)
        rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        conn.close()
        print(f"[admin_all_properties] ERROR: {e}")
        return []


@app.get("/admin/properties/{pid}/detail")
def admin_property_detail(pid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT p.*, u.name as landlord_name
            FROM properties p
            JOIN landlords l ON p.landlord_id=l.id
            JOIN users u ON l.user_id=u.id
            WHERE p.id=%s
        """, (pid,))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        cur.execute("SELECT * FROM rooms WHERE property_id=%s ORDER BY room_number", (pid,))
        rooms = cur.fetchall()
        result = dict(prop)
        rooms_with_tenants = []
        for room in rooms:
            rd = dict(room)
            cur.execute("""
                SELECT t.id, t.name, COALESCE(t.beds_taken,1) as beds_taken, t.move_in_date,
                       COALESCE(r.price_per_bed, r.rent_amount, 0) * COALESCE(t.beds_taken,1) as monthly_rent
                FROM tenants t JOIN rooms r ON t.room_id=r.id
                WHERE t.room_id=%s AND t.is_active=1 ORDER BY t.name
            """, (room["id"],))
            tenants = cur.fetchall()
            rd["tenants"] = [dict(t) for t in tenants]
            rooms_with_tenants.append(rd)
        result["rooms"] = rooms_with_tenants
        return result
    finally:
        conn.close()


@app.get("/admin/tenants/{tid}/detail")
def admin_tenant_detail(tid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT t.*, r.room_number, r.max_beds, r.floor,
                   COALESCE(r.price_per_bed, r.rent_amount, 0) as price_per_bed,
                   p.name as property_name, p.address as property_address, p.property_type,
                   l.business_name, u_l.name as landlord_name
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id=r.id
            LEFT JOIN properties p ON t.property_id=p.id
            LEFT JOIN landlords l ON t.landlord_id=l.id
            LEFT JOIN users u_l ON l.user_id=u_l.id
            WHERE t.id=%s
        """, (tid,))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        cur.execute(
            "SELECT * FROM rent_payments WHERE tenant_id=%s ORDER BY month_year DESC LIMIT 6",
            (tid,),
        )
        rent_history = cur.fetchall()
        return {
            "tenant": dict(tenant),
            "rent_history": [dict(r) for r in rent_history],
        }
    finally:
        conn.close()


@app.get("/admin/tenants")
def admin_all_tenants(user=Depends(require_superadmin)):
    print("HIT: GET /admin/tenants")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT t.id, t.name, t.email, t.phone, t.move_in_date,
                   t.deactivated_by_landlord,
                   u_l.name as landlord_name,
                   l.id as landlord_id_val, l.status as landlord_status,
                   p.name as property_name,
                   r.room_number,
                   r.rent_amount
            FROM tenants t
            JOIN landlords l ON t.landlord_id = l.id
            JOIN users u_l ON l.user_id = u_l.id
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN properties p ON r.property_id = p.id
            WHERE COALESCE(l.is_deleted, 0) = 0
            ORDER BY t.name ASC
        """)
        rows = cur.fetchall()
        conn.close()
        return rows
    except Exception as e:
        conn.close()
        print(f"[admin_all_tenants] ERROR: {e}")
        return []


@app.delete("/admin/landlords/{lid}")
async def delete_landlord(lid: int, user=Depends(require_superadmin)):
    print(f"HIT: DELETE /admin/landlords/{lid}")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        print(f"[DELETE] Starting soft-delete for landlord {lid}")

        cur.execute("SELECT id, user_id FROM landlords WHERE id=%s", (lid,))
        landlord_row = cur.fetchone()
        if not landlord_row:
            conn.close()
            raise HTTPException(status_code=404, detail="Landlord not found")

        landlord_user_id = landlord_row["user_id"]

        cur.execute("SELECT user_id FROM tenants WHERE landlord_id=%s", (lid,))
        tenant_uids = [r["user_id"] for r in cur.fetchall() if r["user_id"]]

        # Log all tenants to audit_log before deletion
        try:
            conn2 = get_db_connection()
            cur2 = conn2.cursor()
            cur2.execute(
                "SELECT * FROM tenants WHERE landlord_id=%s", (lid,)
            )
            tenants_for_log = cur2.fetchall()
            conn2.close()
            for t in tenants_for_log:
                try:
                    cur.execute(
                        """INSERT INTO tenant_audit_log
                           (name,email,phone,cnic,landlord_id,room_id,property_id,move_in_date,deleted_at,deleted_reason)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (t["name"], t["email"], t["phone"], t["cnic"], lid,
                         t["room_id"], t["property_id"], t["move_in_date"],
                         datetime.utcnow().isoformat(), "landlord_deleted"),
                    )
                except Exception:
                    pass
        except Exception:
            pass

        # Hard delete everything EXCEPT the landlord and landlord user records
        for table in ["notifications", "notices", "complaints", "maintenance_requests",
                      "rent_payments", "tenants", "rooms", "properties"]:
            try:
                cur.execute(f"DELETE FROM {table} WHERE landlord_id=%s", (lid,))
            except Exception as e:
                print(f"[DELETE] {table}: {e}")

        for uid in tenant_uids:
            cur.execute("DELETE FROM users WHERE id=%s", (uid,))

        # Hard-delete the landlord's user account so the email is freed for re-registration
        if landlord_user_id:
            cur.execute("DELETE FROM users WHERE id=%s", (landlord_user_id,))

        # Soft delete: mark the landlord record as deleted so history page can show it
        cur.execute(
            "UPDATE landlords SET is_deleted=1, deleted_at=NOW(), status='deleted' WHERE id=%s",
            (lid,),
        )

        conn.commit()
        conn.close()
        print(f"[DELETE] Successfully soft-deleted landlord {lid}")
        return {"message": "Landlord deleted successfully"}
    except HTTPException:
        conn.close()
        raise
    except Exception as e:
        conn.rollback()
        conn.close()
        print(f"[DELETE] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")


@app.put("/admin/landlords/{lid}/reject")
def reject_landlord(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM landlords WHERE id=%s", (lid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Landlord not found")
        cur.execute("UPDATE landlords SET status='rejected', is_approved=0 WHERE id=%s", (lid,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()




# ═══════════════════════════════════════════════════════════════════════════════
# NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/notifications")
def list_notifications(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM notifications WHERE landlord_id=%s ORDER BY created_at DESC LIMIT 50",
            (lid,),
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/notifications/unread-count")
def unread_count(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT COUNT(*) as c FROM notifications WHERE landlord_id=%s AND is_read=0", (lid,)
        )
        count = cur.fetchone()["c"]
        return {"count": count}
    finally:
        conn.close()


@app.put("/notifications/{nid}/read")
def mark_notification_read(nid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE notifications SET is_read=1 WHERE id=%s AND landlord_id=%s", (nid, lid))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.put("/notifications/read-all")
def mark_all_read(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE notifications SET is_read=1 WHERE landlord_id=%s", (lid,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — PROPERTIES
# ═══════════════════════════════════════════════════════════════════════════════

class RoomItem(BaseModel):
    room_number: str
    max_beds: int = 1
    price_per_bed: float
    description: Optional[str] = None


class PropertyCreate(BaseModel):
    name: str
    address: Optional[str] = None
    category: str = "hostel"  # hostel, apartment, house
    sub_type: Optional[str] = None  # whole, individual (for house category)
    rooms: List[RoomItem] = []


@app.get("/properties")
def list_properties(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT p.*,
                   (SELECT COUNT(*) FROM rooms WHERE property_id=p.id) as room_count,
                   (SELECT COALESCE(SUM(max_beds),0) FROM rooms WHERE property_id=p.id) as total_beds,
                   (SELECT COALESCE(SUM(occupied_beds),0) FROM rooms WHERE property_id=p.id) as occupied_beds_total
            FROM properties p WHERE p.landlord_id=%s ORDER BY p.name ASC
        """, (lid,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/properties")
def create_property(body: PropertyCreate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        now = datetime.utcnow().isoformat()
        is_single_bed = body.category == 'apartment' or (body.category == 'house' and body.sub_type == 'whole')
        total = len(body.rooms)
        cur.execute(
            """INSERT INTO properties
               (landlord_id,name,address,property_type,category,sub_type,total_rooms,status,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (lid, body.name, body.address, body.category, body.category, body.sub_type, total, 'pending_approval', now),
        )
        pid = cur.fetchone()["id"]
        for room in body.rooms:
            beds = 1 if is_single_bed else room.max_beds
            ppb = int(room.price_per_bed) if room.price_per_bed else 0
            cur.execute(
                """INSERT INTO rooms
                   (property_id,landlord_id,room_number,floor,capacity,rent_amount,
                    max_beds,price_per_bed,occupied_beds,status,unit_type,description,created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (pid, lid, room.room_number, 0, beds, ppb,
                 beds, ppb, 0, 'vacant', body.category, room.description, now),
            )
        cur.execute(
            "SELECT u.name FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s", (lid,)
        )
        landlord_row = cur.fetchone()
        landlord_name = landlord_row['name'] if landlord_row else 'Unknown'
        create_admin_notification(
            cur, "property",
            f"New property · {body.name} by {landlord_name}",
            "/admin/properties",
        )
        conn.commit()
        cur.execute("SELECT * FROM properties WHERE id=%s", (pid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/properties/{pid}")
def get_property(pid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM properties WHERE id=%s AND landlord_id=%s", (pid, lid))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Property not found")
        cur.execute("SELECT * FROM rooms WHERE property_id=%s ORDER BY room_number", (pid,))
        rooms = cur.fetchall()
        result = dict(row)
        result["rooms"] = [dict(r) for r in rooms]
        return result
    finally:
        conn.close()


class PropertyUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None


@app.put("/properties/{pid}")
def update_property(pid: int, body: PropertyUpdate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM properties WHERE id=%s AND landlord_id=%s", (pid, lid))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        updates = {k: v for k, v in body.dict().items() if v is not None}
        if updates:
            set_clause = ", ".join(f"{k}=%s" for k in updates)
            cur.execute(f"UPDATE properties SET {set_clause} WHERE id=%s", list(updates.values()) + [pid])
            conn.commit()
        cur.execute("SELECT * FROM properties WHERE id=%s", (pid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.delete("/properties/{pid}")
def delete_property(pid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM properties WHERE id=%s AND landlord_id=%s", (pid, lid))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")

        cur.execute("SELECT id FROM rooms WHERE property_id=%s", (pid,))
        rooms = cur.fetchall()
        room_ids = [r["id"] for r in rooms]

        tenants = []
        if room_ids:
            placeholders = ",".join(["%s"] * len(room_ids))
            cur.execute(
                f"SELECT * FROM tenants WHERE room_id IN ({placeholders})", room_ids
            )
            tenants = cur.fetchall()

        # Log tenants to audit and send notifications before deletion
        for t in tenants:
            try:
                cur.execute(
                    """INSERT INTO tenant_audit_log
                       (name,email,phone,cnic,landlord_id,room_id,property_id,move_in_date,deleted_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (t["name"], t["email"], t["phone"], t["cnic"],
                     t["landlord_id"], t["room_id"], t["property_id"],
                     t["move_in_date"], datetime.utcnow().isoformat()),
                )
            except Exception:
                pass
            create_tenant_notification(
                cur, t["id"], "property_deleted",
                "Your landlord has removed the property you were living in. Please contact your landlord."
            )

        # Delete tenant-linked records and user accounts
        tenant_ids = [t["id"] for t in tenants]
        tenant_user_ids = [t["user_id"] for t in tenants if t["user_id"]]
        if tenant_ids:
            placeholders = ",".join(["%s"] * len(tenant_ids))
            cur.execute(f"DELETE FROM rent_payments WHERE tenant_id IN ({placeholders})", tenant_ids)
            cur.execute(f"DELETE FROM maintenance_requests WHERE tenant_id IN ({placeholders})", tenant_ids)
            cur.execute(f"DELETE FROM complaints WHERE tenant_id IN ({placeholders})", tenant_ids)
            cur.execute(f"DELETE FROM tenant_notifications WHERE tenant_id IN ({placeholders})", tenant_ids)
            cur.execute(f"DELETE FROM tenants WHERE id IN ({placeholders})", tenant_ids)
        if tenant_user_ids:
            placeholders = ",".join(["%s"] * len(tenant_user_ids))
            cur.execute(f"DELETE FROM users WHERE id IN ({placeholders})", tenant_user_ids)
        if room_ids:
            placeholders = ",".join(["%s"] * len(room_ids))
            cur.execute(f"DELETE FROM rooms WHERE id IN ({placeholders})", room_ids)
        cur.execute("DELETE FROM properties WHERE id=%s", (pid,))

        cur.execute("SELECT u.name FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s", (lid,))
        ll = cur.fetchone()
        landlord_name = ll["name"] if ll else "Unknown"
        msg = f"Landlord {landlord_name} deleted property {prop['name']}"
        if tenants:
            msg += f" ({len(tenants)} tenant{'s' if len(tenants) != 1 else ''} removed)"
        create_admin_notification(cur, "property", msg, "/admin/properties")

        conn.commit()
        return {"success": True, "tenants_removed": len(tenants)}
    finally:
        conn.close()


@app.put("/admin/properties/{pid}/approve")
def approve_property(pid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM properties WHERE id=%s", (pid,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Property not found")
        cur.execute("UPDATE properties SET status='approved' WHERE id=%s", (pid,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.put("/admin/properties/{pid}/reject")
def reject_property(pid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM properties WHERE id=%s", (pid,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Property not found")
        cur.execute("UPDATE properties SET status='rejected' WHERE id=%s", (pid,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — ROOMS
# ═══════════════════════════════════════════════════════════════════════════════

class RoomCreate(BaseModel):
    room_number: str
    floor: Optional[int] = None
    max_beds: int = 1
    price_per_bed: float
    unit_type: str = "hostel_room"
    description: Optional[str] = None
    # legacy compat
    capacity: Optional[int] = None
    rent_amount: Optional[float] = None


class RoomUpdate(BaseModel):
    room_number: Optional[str] = None
    floor: Optional[int] = None
    max_beds: Optional[int] = None
    price_per_bed: Optional[float] = None
    capacity: Optional[int] = None
    rent_amount: Optional[float] = None
    unit_type: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


@app.get("/properties/{pid}/rooms")
def list_property_rooms(pid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM properties WHERE id=%s AND landlord_id=%s", (pid, lid))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        cur.execute("SELECT * FROM rooms WHERE property_id=%s ORDER BY room_number", (pid,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/properties/{pid}/rooms-with-tenants")
def list_rooms_with_tenants(pid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM properties WHERE id=%s AND landlord_id=%s", (pid, lid))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        cur.execute("SELECT * FROM rooms WHERE property_id=%s ORDER BY room_number", (pid,))
        rooms = cur.fetchall()
        result = []
        for room in rooms:
            room_dict = dict(room)
            cur.execute("""
                SELECT t.id, t.name, COALESCE(t.beds_taken,1) as beds_taken, t.move_in_date,
                       COALESCE(r.price_per_bed, r.rent_amount, 0) * COALESCE(t.beds_taken,1) as monthly_rent
                FROM tenants t
                JOIN rooms r ON t.room_id=r.id
                WHERE t.room_id=%s AND t.is_active=1
                ORDER BY t.name
            """, (room["id"],))
            tenants = cur.fetchall()
            room_dict["tenants"] = [dict(t) for t in tenants]
            result.append(room_dict)
        return result
    finally:
        conn.close()


@app.post("/properties/{pid}/rooms")
def create_room(pid: int, body: RoomCreate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM properties WHERE id=%s AND landlord_id=%s", (pid, lid))
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found")
        now = datetime.utcnow().isoformat()
        beds = body.max_beds if body.max_beds else (body.capacity or 1)
        ppb = body.price_per_bed if body.price_per_bed else (body.rent_amount or 0)
        cur.execute(
            """INSERT INTO rooms
               (property_id,landlord_id,room_number,floor,capacity,rent_amount,
                max_beds,price_per_bed,occupied_beds,status,unit_type,description,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (pid, lid, body.room_number, body.floor, beds, ppb,
             beds, ppb, 0, "vacant", body.unit_type, body.description, now),
        )
        rid = cur.fetchone()["id"]
        cur.execute("UPDATE properties SET total_rooms=total_rooms+1 WHERE id=%s", (pid,))
        conn.commit()
        cur.execute("SELECT * FROM rooms WHERE id=%s", (rid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/rooms")
def list_all_rooms(property_id: Optional[int] = None, available_only: bool = False, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        base = """
            SELECT r.*, p.name as property_name, p.status as property_status,
                   (r.max_beds - r.occupied_beds) as available_beds
            FROM rooms r
            JOIN properties p ON r.property_id=p.id
            WHERE r.landlord_id=%s
        """
        params: list = [lid]
        if property_id:
            base += " AND r.property_id=%s"
            params.append(property_id)
        if available_only:
            base += " AND p.status='approved' AND r.occupied_beds < r.max_beds"
        base += " ORDER BY r.room_number"
        cur.execute(base, params)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/rooms/{rid}")
def update_room(rid: int, body: RoomUpdate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM rooms WHERE id=%s AND landlord_id=%s", (rid, lid))
        room = cur.fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        updates = {k: v for k, v in body.dict().items() if v is not None}
        if updates:
            set_clause = ", ".join(f"{k}=%s" for k in updates)
            cur.execute(f"UPDATE rooms SET {set_clause} WHERE id=%s", list(updates.values()) + [rid])
            conn.commit()
        cur.execute("SELECT * FROM rooms WHERE id=%s", (rid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.delete("/rooms/{rid}")
def delete_room(rid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM rooms WHERE id=%s AND landlord_id=%s", (rid, lid))
        room = cur.fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        if (room["occupied_beds"] or 0) > 0:
            raise HTTPException(status_code=400, detail="Cannot delete a room with occupants")
        cur.execute("DELETE FROM rooms WHERE id=%s", (rid,))
        cur.execute("UPDATE properties SET total_rooms=total_rooms-1 WHERE id=%s", (room["property_id"],))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — TENANTS
# ═══════════════════════════════════════════════════════════════════════════════

class TenantCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    cnic: Optional[str] = None
    emergency_contact: Optional[str] = None
    move_in_date: Optional[str] = None


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    cnic: Optional[str] = None
    emergency_contact: Optional[str] = None


class AssignRoomRequest(BaseModel):
    room_id: int
    beds_taken: int = 1
    rent_due_day: int = 1


@app.get("/tenants")
def list_tenants(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT t.*, r.room_number, p.name as property_name
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id=r.id
            LEFT JOIN properties p ON t.property_id=p.id
            WHERE t.landlord_id=%s
            ORDER BY t.name ASC
        """, (lid,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/tenants")
def create_tenant(body: TenantCreate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        now = datetime.utcnow().isoformat()
        temp_password = generate_temp_password()
        user_id = None

        if body.email:
            cur.execute("SELECT id FROM users WHERE email=%s", (body.email,))
            existing = cur.fetchone()
            if existing:
                raise HTTPException(status_code=400, detail="A user with this email already exists")
            cur.execute(
                "INSERT INTO users (name,email,password_hash,role,is_active,created_at) VALUES (%s,%s,%s,%s,1,%s) RETURNING id",
                (body.name, body.email, hash_password(temp_password), "tenant", now),
            )
            user_id = cur.fetchone()["id"]

        cur.execute(
            """INSERT INTO tenants (user_id,landlord_id,name,email,phone,cnic,emergency_contact,
               move_in_date,is_active,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1,%s) RETURNING id""",
            (user_id, lid, body.name, body.email, body.phone, body.cnic,
             body.emergency_contact, body.move_in_date, now),
        )
        tid = cur.fetchone()["id"]
        cur.execute(
            "SELECT u.name FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s", (lid,)
        )
        landlord_row = cur.fetchone()
        landlord_name = landlord_row['name'] if landlord_row else 'Unknown'
        create_admin_notification(
            cur, "tenant",
            f"New tenant · {body.name} by {landlord_name}",
            "/admin/tenants",
        )
        conn.commit()
        cur.execute("SELECT * FROM tenants WHERE id=%s", (tid,))
        row = cur.fetchone()
        result = dict(row)
        result["temp_password"] = temp_password if body.email else None
        return result
    finally:
        conn.close()


@app.put("/tenants/{tid}")
def update_tenant(tid: int, body: TenantUpdate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE id=%s AND landlord_id=%s", (tid, lid))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        updates = {k: v for k, v in body.dict().items() if v is not None}
        if updates:
            set_clause = ", ".join(f"{k}=%s" for k in updates)
            cur.execute(f"UPDATE tenants SET {set_clause} WHERE id=%s", list(updates.values()) + [tid])
            conn.commit()
        cur.execute("SELECT * FROM tenants WHERE id=%s", (tid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.delete("/tenants/{tid}")
def delete_tenant(tid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE id=%s AND landlord_id=%s", (tid, lid))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")

        # Log to audit before deleting
        try:
            cur.execute(
                """INSERT INTO tenant_audit_log
                   (name,email,phone,cnic,landlord_id,room_id,property_id,move_in_date,deleted_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (tenant["name"], tenant["email"], tenant["phone"], tenant["cnic"],
                 tenant["landlord_id"], tenant["room_id"], tenant["property_id"],
                 tenant["move_in_date"], datetime.utcnow().isoformat()),
            )
        except Exception:
            pass  # audit log is best-effort

        # Free up room beds correctly
        if tenant["room_id"]:
            beds = tenant["beds_taken"] or 1
            cur.execute("SELECT max_beds, occupied_beds FROM rooms WHERE id=%s", (tenant["room_id"],))
            room = cur.fetchone()
            if room:
                new_occ = max(0, (room["occupied_beds"] or 0) - beds)
                new_status = 'vacant' if new_occ == 0 else 'available'
                cur.execute("UPDATE rooms SET occupied_beds=%s, status=%s WHERE id=%s",
                            (new_occ, new_status, tenant["room_id"]))

        # Get landlord name for admin notification
        cur.execute("SELECT u.name FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s", (lid,))
        ll = cur.fetchone()
        landlord_name = ll["name"] if ll else "Unknown"
        create_admin_notification(cur, "tenant", f"Landlord {landlord_name} deleted tenant {tenant['name']}", "/admin/tenants")

        cur.execute("DELETE FROM rent_payments WHERE tenant_id=%s", (tid,))
        cur.execute("DELETE FROM maintenance_requests WHERE tenant_id=%s", (tid,))
        cur.execute("DELETE FROM complaints WHERE tenant_id=%s", (tid,))
        cur.execute("DELETE FROM tenants WHERE id=%s", (tid,))
        if tenant["user_id"]:
            cur.execute("DELETE FROM users WHERE id=%s", (tenant["user_id"],))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.put("/tenants/{tid}/assign-room")
def assign_room(tid: int, body: AssignRoomRequest, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE id=%s AND landlord_id=%s", (tid, lid))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        cur.execute("SELECT * FROM rooms WHERE id=%s AND landlord_id=%s", (body.room_id, lid))
        room = cur.fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        max_b = room["max_beds"] or 1
        occ_b = room["occupied_beds"] or 0
        available = max_b - occ_b
        beds = max(1, min(body.beds_taken, available))
        if available <= 0:
            raise HTTPException(status_code=400, detail="Room is full — no beds available")
        rent_due_day = max(1, min(28, body.rent_due_day or 1))
        new_occ = occ_b + beds
        new_status = 'full' if new_occ >= max_b else 'available'
        cur.execute("UPDATE tenants SET room_id=%s, property_id=%s, beds_taken=%s, rent_due_day=%s WHERE id=%s",
                    (body.room_id, room["property_id"], beds, rent_due_day, tid))
        cur.execute("UPDATE rooms SET occupied_beds=%s, status=%s, capacity=max_beds, rent_amount=price_per_bed WHERE id=%s",
                    (new_occ, new_status, body.room_id))
        conn.commit()
        cur.execute("SELECT * FROM tenants WHERE id=%s", (tid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.put("/tenants/{tid}/vacate")
def vacate_tenant(tid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE id=%s AND landlord_id=%s", (tid, lid))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        if tenant["room_id"]:
            beds = tenant["beds_taken"] if tenant["beds_taken"] else 1
            cur.execute("SELECT max_beds, occupied_beds FROM rooms WHERE id=%s", (tenant["room_id"],))
            room = cur.fetchone()
            if room:
                new_occ = max(0, (room["occupied_beds"] or 0) - beds)
                new_status = 'vacant' if new_occ == 0 else 'available'
                cur.execute("UPDATE rooms SET occupied_beds=%s, status=%s WHERE id=%s",
                            (new_occ, new_status, tenant["room_id"]))
        now = datetime.utcnow().date().isoformat()
        cur.execute("UPDATE tenants SET room_id=NULL, property_id=NULL, beds_taken=0, move_out_date=%s WHERE id=%s", (now, tid))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — RENT
# ═══════════════════════════════════════════════════════════════════════════════

class GenerateRentRequest(BaseModel):
    month_year: Optional[str] = None
    tenant_ids: Optional[List[int]] = None


class RentStatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


class RentRejectRequest(BaseModel):
    notes: str


@app.get("/rent")
def list_rent(month_year: Optional[str] = None, tenant_id: Optional[int] = None, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        query = """
            SELECT rp.*, t.name as tenant_name,
                   COALESCE(r.room_number, '') as room_number,
                   COALESCE(p.name, '') as property_name
            FROM rent_payments rp
            JOIN tenants t ON rp.tenant_id=t.id
            LEFT JOIN rooms r ON rp.room_id=r.id
            LEFT JOIN properties p ON r.property_id=p.id
            WHERE rp.landlord_id=%s
        """
        params = [lid]
        if month_year:
            query += " AND rp.month_year=%s"
            params.append(month_year)
        if tenant_id:
            query += " AND rp.tenant_id=%s"
            params.append(tenant_id)
        query += " ORDER BY t.name ASC, rp.month_year DESC"
        cur.execute(query, params)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/rent/generate")
def generate_rent(body: GenerateRentRequest, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        month_year = body.month_year or datetime.utcnow().strftime("%Y-%m")
        year, month = map(int, month_year.split("-"))
        # If the 5th of the generated month has already passed, push due date to 5th of next month
        fifth = date(year, month, 5)
        if date.today() > fifth:
            due_date = f"{year + 1}-01-05" if month == 12 else f"{year}-{month + 1:02d}-05"
        else:
            due_date = f"{year}-{month:02d}-05"

        cur.execute(
            "SELECT id, room_id, name, COALESCE(beds_taken,1) as beds_taken FROM tenants WHERE landlord_id=%s", (lid,)
        )
        all_tenants = cur.fetchall()

        # Filter to specific tenant_ids if provided
        if body.tenant_ids:
            all_tenants = [t for t in all_tenants if t["id"] in body.tenant_ids]

        print(f"[generate_rent] landlord_id={lid} | month={month_year} | tenants_found={len(all_tenants)}")

        created = 0
        now = datetime.utcnow().isoformat()

        for t in all_tenants:
            if not t["room_id"]:
                print(f"[generate_rent]  skip '{t['name']}' — no room assigned")
                continue
            cur.execute(
                "SELECT id FROM rent_payments WHERE tenant_id=%s AND month_year=%s",
                (t["id"], month_year),
            )
            existing = cur.fetchone()
            if existing:
                print(f"[generate_rent]  skip '{t['name']}' — entry already exists")
                continue
            cur.execute(
                "SELECT price_per_bed, rent_amount FROM rooms WHERE id=%s", (t["room_id"],)
            )
            room = cur.fetchone()
            if not room:
                print(f"[generate_rent]  skip '{t['name']}' — room record missing")
                continue
            ppb = room["price_per_bed"] if room["price_per_bed"] else (room["rent_amount"] or 0)
            beds = t["beds_taken"] if t["beds_taken"] else 1
            amount = int(ppb) * beds
            cur.execute(
                """INSERT INTO rent_payments
                   (tenant_id,landlord_id,room_id,amount,month_year,status,due_date,created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (t["id"], lid, t["room_id"], amount, month_year, "pending", due_date, now),
            )
            created += 1
            create_tenant_notification(cur, t["id"], "rent",
                f"Rent due · Rs {amount:,} · {month_year} · Due {due_date}")
            print(f"[generate_rent]  created entry for '{t['name']}'")

        conn.commit()
        print(f"[generate_rent] DONE — created={created}")
        return {
            "message": f"Generated {created} rent entries for {month_year}",
            "created": created,
            "count": created,
            "month_year": month_year,
        }
    finally:
        conn.close()


@app.put("/rent/{rid}/status")
def update_rent_status(rid: int, body: RentStatusUpdate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM rent_payments WHERE id=%s AND landlord_id=%s", (rid, lid))
        rp = cur.fetchone()
        if not rp:
            raise HTTPException(status_code=404, detail="Payment not found")
        now = datetime.utcnow().isoformat()
        paid_at = now if body.status == "paid" else None
        cur.execute(
            "UPDATE rent_payments SET status=%s, notes=%s, paid_at=%s WHERE id=%s",
            (body.status, body.notes, paid_at, rid),
        )
        conn.commit()

        # Generate receipt PDF when manually marking as paid
        if body.status == "paid":
            try:
                pdf_buf = generate_receipt_pdf(rid)
                if pdf_buf:
                    rel_path = _save_receipt_pdf(rid, pdf_buf)
                    if rel_path:
                        cur.execute("UPDATE rent_payments SET receipt_pdf_path=%s WHERE id=%s", (rel_path, rid))
                        cur.execute("SELECT * FROM tenants WHERE id=%s", (rp["tenant_id"],))
                        tenant = cur.fetchone()
                        if tenant:
                            create_tenant_notification(cur, tenant["id"], "payment",
                                f"Your rent receipt for {rp['month_year']} is ready. Download it from your Rent History.")
                        create_notification(cur, lid, "payment",
                            f"Receipt generated for {tenant['name'] if tenant else 'tenant'} — {rp['month_year']} rent confirmed")
                        conn.commit()
            except Exception as exc:
                print(f"[PDF] Receipt generation error: {exc}")

        cur.execute("SELECT * FROM rent_payments WHERE id=%s", (rid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.put("/rent/{rid}/verify")
def verify_rent_payment(rid: int, user=Depends(require_landlord)):
    """Landlord confirms a tenant-submitted payment → marks as paid."""
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM rent_payments WHERE id=%s AND landlord_id=%s", (rid, lid))
        rp = cur.fetchone()
        if not rp:
            raise HTTPException(status_code=404, detail="Payment not found")
        now = datetime.utcnow().isoformat()
        cur.execute(
            """UPDATE rent_payments
               SET status='paid', paid_at=%s, verified_by=%s, verified_at=%s
               WHERE id=%s""",
            (now, user["sub"], now, rid),
        )
        # Basic confirmation notification
        cur.execute("SELECT * FROM tenants WHERE id=%s", (rp["tenant_id"],))
        tenant = cur.fetchone()
        if tenant:
            create_tenant_notification(cur, tenant["id"], "payment",
                f"Rent confirmed · Rs {int(rp['amount']):,} · {rp['month_year']}")
        conn.commit()

        # Generate receipt PDF
        try:
            pdf_buf = generate_receipt_pdf(rid)
            if pdf_buf:
                rel_path = _save_receipt_pdf(rid, pdf_buf)
                if rel_path:
                    cur.execute("UPDATE rent_payments SET receipt_pdf_path=%s WHERE id=%s", (rel_path, rid))
                    if tenant:
                        create_tenant_notification(cur, tenant["id"], "payment",
                            f"Your rent receipt for {rp['month_year']} is ready. Download it from your Rent History.")
                    create_notification(cur, lid, "payment",
                        f"Receipt generated for {tenant['name'] if tenant else 'tenant'} — {rp['month_year']} rent confirmed")
                    conn.commit()
        except Exception as exc:
            print(f"[PDF] Receipt generation error: {exc}")

        cur.execute("SELECT * FROM rent_payments WHERE id=%s", (rid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/rent/tenants")
def rent_tenants_status(month_year: Optional[str] = None, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    my = month_year or datetime.utcnow().strftime("%Y-%m")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT t.id, t.name, t.email, t.room_id, COALESCE(t.beds_taken,1) as beds_taken,
                   r.room_number, COALESCE(r.price_per_bed, r.rent_amount, 0) as price_per_bed,
                   p.name as property_name
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id=r.id
            LEFT JOIN properties p ON t.property_id=p.id
            WHERE t.landlord_id=%s AND t.is_active=1 AND t.room_id IS NOT NULL
            ORDER BY t.name
        """, (lid,))
        tenants = cur.fetchall()
        result = []
        for t in tenants:
            ppb = t["price_per_bed"] or 0
            amount = ppb * (t["beds_taken"] or 1)
            cur.execute(
                "SELECT id FROM rent_payments WHERE tenant_id=%s AND month_year=%s",
                (t["id"], my)
            )
            has_rent = bool(cur.fetchone())
            d = dict(t)
            d["expected_amount"] = amount
            d["has_rent_generated"] = has_rent
            result.append(d)
        return result
    finally:
        conn.close()


@app.put("/rent/{rid}/reject-payment")
def reject_rent_payment(rid: int, body: RentRejectRequest, user=Depends(require_landlord)):
    """Landlord rejects a pending_verification payment → sends back to pending."""
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM rent_payments WHERE id=%s AND landlord_id=%s", (rid, lid))
        rp = cur.fetchone()
        if not rp:
            raise HTTPException(status_code=404, detail="Payment not found")
        cur.execute(
            "UPDATE rent_payments SET status='pending', notes=%s, paid_at=NULL, receipt_image=NULL WHERE id=%s",
            (f"Rejected: {body.notes}", rid),
        )
        # Notify tenant
        cur.execute("SELECT * FROM tenants WHERE id=%s", (rp["tenant_id"],))
        tenant = cur.fetchone()
        if tenant:
            create_tenant_notification(cur, tenant["id"], "payment",
                f"Payment rejected · {rp['month_year']} · Please resubmit")
        conn.commit()
        cur.execute("SELECT * FROM rent_payments WHERE id=%s", (rid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/rent/{rid}/receipt")
def download_rent_receipt(rid: int, user=Depends(current_user)):
    """Download the PDF receipt for a confirmed rent payment (tenant or landlord)."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        if user["role"] == "tenant":
            cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
            tenant = cur.fetchone()
            if not tenant:
                raise HTTPException(status_code=403, detail="Tenant not found")
            cur.execute("SELECT * FROM rent_payments WHERE id=%s AND tenant_id=%s",
                             (rid, tenant["id"]))
            rp = cur.fetchone()
        elif user["role"] == "landlord":
            cur.execute("SELECT * FROM rent_payments WHERE id=%s AND landlord_id=%s",
                             (rid, user["landlord_id"]))
            rp = cur.fetchone()
        else:
            cur.execute("SELECT * FROM rent_payments WHERE id=%s", (rid,))
            rp = cur.fetchone()

        if not rp:
            raise HTTPException(status_code=404, detail="Payment not found")
        if rp["status"] != "paid":
            raise HTTPException(status_code=400, detail="Receipt is only available for confirmed payments")
    finally:
        conn.close()

    pdf_buf = generate_receipt_pdf(rid)
    if not pdf_buf:
        raise HTTPException(status_code=500, detail="Could not generate receipt — ensure reportlab is installed")

    return StreamingResponse(
        pdf_buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="receipt_{rid}.pdf"'},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — MAINTENANCE
# ═══════════════════════════════════════════════════════════════════════════════

class MaintenanceStatusUpdate(BaseModel):
    status: str


@app.get("/maintenance")
def list_maintenance(status_filter: Optional[str] = None, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        query = """
            SELECT m.*, t.name as tenant_name, r.room_number
            FROM maintenance_requests m
            JOIN tenants t ON m.tenant_id=t.id
            JOIN rooms r ON m.room_id=r.id
            WHERE m.landlord_id=%s
        """
        params = [lid]
        if status_filter:
            query += " AND m.status=%s"
            params.append(status_filter)
        query += " ORDER BY t.name ASC, m.created_at DESC"
        cur.execute(query, params)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/maintenance/{mid}/status")
def update_maintenance(mid: int, body: MaintenanceStatusUpdate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM maintenance_requests WHERE id=%s AND landlord_id=%s", (mid, lid))
        m = cur.fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Request not found")
        now = datetime.utcnow().isoformat()
        resolved_at = now if body.status in ("resolved", "closed") else None
        cur.execute("UPDATE maintenance_requests SET status=%s, resolved_at=%s WHERE id=%s",
                    (body.status, resolved_at, mid))
        create_tenant_notification(cur, m["tenant_id"], "maintenance",
            f"Maintenance update · {m['title']} · {body.status}")
        conn.commit()
        cur.execute("SELECT * FROM maintenance_requests WHERE id=%s", (mid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


class MaintenanceNotesUpdate(BaseModel):
    notes: str


@app.put("/maintenance/{mid}/notes")
def update_maintenance_notes(mid: int, body: MaintenanceNotesUpdate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM maintenance_requests WHERE id=%s AND landlord_id=%s", (mid, lid))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Request not found")
        cur.execute("UPDATE maintenance_requests SET notes=%s WHERE id=%s", (body.notes, mid))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — COMPLAINTS
# ═══════════════════════════════════════════════════════════════════════════════

class ComplaintResponse(BaseModel):
    landlord_response: str
    status: str = "in_progress"


@app.get("/complaints")
def list_complaints(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT c.*, t.name as tenant_name, t.phone as tenant_phone,
                   r.room_number, p.name as property_name
            FROM complaints c
            JOIN tenants t ON c.tenant_id=t.id
            LEFT JOIN rooms r ON t.room_id=r.id
            LEFT JOIN properties p ON r.property_id=p.id
            WHERE c.landlord_id=%s
            ORDER BY c.created_at DESC
        """, (lid,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/complaints/{cid}/respond")
def respond_complaint(cid: int, body: ComplaintResponse, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM complaints WHERE id=%s AND landlord_id=%s", (cid, lid))
        c = cur.fetchone()
        if not c:
            raise HTTPException(status_code=404, detail="Complaint not found")
        now = datetime.utcnow().isoformat()
        resolved_at = now if body.status == "resolved" else None
        cur.execute(
            "UPDATE complaints SET landlord_response=%s, status=%s, resolved_at=%s WHERE id=%s",
            (body.landlord_response, body.status, resolved_at, cid),
        )
        create_tenant_notification(cur, c["tenant_id"], "complaint",
            f"Complaint response · {c['title']}")
        conn.commit()
        cur.execute("SELECT * FROM complaints WHERE id=%s", (cid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — NOTICES
# ═══════════════════════════════════════════════════════════════════════════════

class NoticeCreate(BaseModel):
    title: str
    message: str
    property_id: Optional[int] = None
    tenant_id: Optional[int] = None


@app.get("/notices")
def list_notices(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT n.*, p.name as property_name
            FROM notices n
            LEFT JOIN properties p ON n.property_id=p.id
            WHERE n.landlord_id=%s
            ORDER BY n.title ASC
        """, (lid,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/notices")
def create_notice(body: NoticeCreate, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        now = datetime.utcnow().isoformat()
        cur.execute(
            "INSERT INTO notices (landlord_id,property_id,title,message,is_active,created_at) VALUES (%s,%s,%s,%s,1,%s) RETURNING id",
            (lid, body.property_id, body.title, body.message, now),
        )
        nid = cur.fetchone()["id"]
        # Fire tenant notifications
        try:
            if body.tenant_id:
                cur.execute(
                    "SELECT id FROM tenants WHERE id=%s AND landlord_id=%s AND is_active=1",
                    (body.tenant_id, lid)
                )
                tenant_rows = cur.fetchall()
            elif body.property_id:
                cur.execute("""
                    SELECT t.id FROM tenants t
                    JOIN rooms r ON t.room_id=r.id
                    WHERE r.property_id=%s AND t.landlord_id=%s AND t.is_active=1
                """, (body.property_id, lid))
                tenant_rows = cur.fetchall()
            else:
                cur.execute(
                    "SELECT id FROM tenants WHERE landlord_id=%s AND is_active=1", (lid,)
                )
                tenant_rows = cur.fetchall()
            for t in tenant_rows:
                create_tenant_notification(
                    cur, t["id"], "notice",
                    f"New notice from your landlord: {body.title}"
                )
        except Exception:
            pass
        conn.commit()
        cur.execute("SELECT * FROM notices WHERE id=%s", (nid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.delete("/notices/{nid}")
def delete_notice(nid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM notices WHERE id=%s AND landlord_id=%s", (nid, lid))
        n = cur.fetchone()
        if not n:
            raise HTTPException(status_code=404, detail="Notice not found")
        cur.execute("DELETE FROM notices WHERE id=%s", (nid,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — REPORTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/reports/revenue")
def revenue_report(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        month_year = datetime.utcnow().strftime("%Y-%m")
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND status='paid' AND month_year=%s",
            (lid, month_year),
        )
        collected = scalar(cur)
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND status='pending' AND month_year=%s",
            (lid, month_year),
        )
        pending = scalar(cur)
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND status='overdue'",
            (lid,),
        )
        overdue = scalar(cur)
        return {"collected_this_month": collected, "pending_this_month": pending, "overdue_amount": overdue}
    finally:
        conn.close()


@app.get("/reports/occupancy")
def occupancy_report(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT p.id, p.name,
                   COALESCE(SUM(r.max_beds), 0) as total_beds,
                   COALESCE(SUM(r.occupied_beds), 0) as occupied_beds
            FROM properties p
            LEFT JOIN rooms r ON r.property_id=p.id
            WHERE p.landlord_id=%s
            GROUP BY p.id
            ORDER BY p.name ASC
        """, (lid,))
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            total = d["total_beds"] or 0
            occ = d["occupied_beds"] or 0
            d["occupancy_rate"] = round(occ / total * 100, 1) if total > 0 else 0
            result.append(d)
        return result
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — OVERVIEW STATS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/landlord/stats")
def landlord_stats(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) as c FROM rooms WHERE landlord_id=%s", (lid,))
        total_rooms = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) as c FROM rooms WHERE landlord_id=%s AND status='occupied'", (lid,))
        occupied = cur.fetchone()["c"]
        current_month = datetime.utcnow().strftime("%Y-%m")

        # Bed-based stats
        cur.execute(
            "SELECT COALESCE(SUM(max_beds),0) as total_beds, COALESCE(SUM(occupied_beds),0) as occupied_beds FROM rooms WHERE landlord_id=%s",
            (lid,)
        )
        bed_row = cur.fetchone()
        total_beds = bed_row["total_beds"]
        occupied_beds = bed_row["occupied_beds"]

        # Property stats
        cur.execute(
            """SELECT COUNT(*) as total,
                      SUM(CASE WHEN COALESCE(status,'approved')='approved' THEN 1 ELSE 0 END) as approved,
                      SUM(CASE WHEN status='pending_approval' THEN 1 ELSE 0 END) as pending
               FROM properties WHERE landlord_id=%s""",
            (lid,)
        )
        prop_row = cur.fetchone()

        # Financial — only count landlord-confirmed (paid) payments
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM rent_payments WHERE landlord_id=%s AND month_year=%s AND status='paid'",
            (lid, current_month),
        )
        monthly_revenue = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM rent_payments WHERE landlord_id=%s AND month_year=%s AND status='pending'",
            (lid, current_month),
        )
        pending_rent = cur.fetchone()["s"]
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s, COUNT(*) as c FROM rent_payments WHERE landlord_id=%s AND status='overdue'",
            (lid,),
        )
        overdue_row = cur.fetchone()
        overdue_rent = overdue_row["s"]
        overdue_count = overdue_row["c"]

        cur.execute(
            "SELECT COUNT(*) as c FROM maintenance_requests WHERE landlord_id=%s AND status='open'", (lid,)
        )
        pending_maintenance = cur.fetchone()["c"]
        cur.execute(
            "SELECT priority, COUNT(*) as c FROM maintenance_requests WHERE landlord_id=%s AND status='open' GROUP BY priority",
            (lid,)
        )
        maint_rows = cur.fetchall()
        maint_by_priority = {r["priority"]: r["c"] for r in maint_rows}

        cur.execute(
            "SELECT COUNT(*) as c FROM complaints WHERE landlord_id=%s AND status='open'", (lid,)
        )
        open_complaints = cur.fetchone()["c"]
        cur.execute(
            "SELECT COUNT(*) as c FROM rent_payments WHERE landlord_id=%s AND status='pending_verification'", (lid,)
        )
        pending_verification = cur.fetchone()["c"]

        cur.execute(
            "SELECT * FROM notifications WHERE landlord_id=%s ORDER BY created_at DESC LIMIT 5", (lid,)
        )
        recent_notifications = cur.fetchall()

        return {
            "total_rooms": total_rooms,
            "occupied": occupied,
            "vacant": total_rooms - occupied,
            "total_beds": total_beds,
            "occupied_beds": occupied_beds,
            "vacant_beds": total_beds - occupied_beds,
            "total_properties": prop_row["total"] or 0,
            "approved_properties": prop_row["approved"] or 0,
            "pending_properties": prop_row["pending"] or 0,
            "monthly_revenue": monthly_revenue,
            "pending_rent": pending_rent,
            "overdue_rent": overdue_rent,
            "overdue_count": overdue_count,
            "pending_maintenance": pending_maintenance,
            "maintenance_by_priority": maint_by_priority,
            "open_complaints": open_complaints,
            "pending_verification": pending_verification,
            "recent_notifications": [dict(r) for r in recent_notifications],
        }
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# TENANT ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/my/profile")
def my_profile(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE user_id=%s", (user["sub"],))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Tenant profile not found")
        return dict(row)
    finally:
        conn.close()


@app.get("/my/room")
def my_room(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant or not tenant["room_id"]:
            return {"room": None, "property": None, "beds_taken": 0, "roommates": 0, "move_in_date": None, "landlord": None}
        cur.execute("SELECT * FROM rooms WHERE id=%s", (tenant["room_id"],))
        room = cur.fetchone()
        cur.execute("SELECT * FROM properties WHERE id=%s", (tenant["property_id"],))
        prop = cur.fetchone()
        cur.execute(
            "SELECT COUNT(*) as c FROM tenants WHERE room_id=%s AND user_id != %s AND is_active=1",
            (tenant["room_id"], user["sub"])
        )
        roommates = cur.fetchone()["c"]
        cur.execute(
            "SELECT l.business_name, l.phone FROM landlords l WHERE l.id=%s", (tenant["landlord_id"],)
        )
        landlord_row = cur.fetchone()
        return {
            "room": dict(room) if room else None,
            "property": dict(prop) if prop else None,
            "beds_taken": tenant["beds_taken"] or 1,
            "roommates": roommates,
            "move_in_date": tenant["move_in_date"],
            "landlord": dict(landlord_row) if landlord_row else None,
        }
    finally:
        conn.close()


@app.get("/my/dashboard")
def my_dashboard(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        empty = {
            "room": None, "property": None, "beds_taken": 0, "roommates": 0,
            "move_in_date": None, "landlord": None, "current_rent": None,
            "maintenance_open": 0, "complaints_open": 0, "notices_unread": 0,
        }
        if not tenant:
            return empty

        room = None
        prop = None
        roommates = 0
        if tenant["room_id"]:
            cur.execute("SELECT * FROM rooms WHERE id=%s", (tenant["room_id"],))
            room = cur.fetchone()
            cur.execute("SELECT * FROM properties WHERE id=%s", (tenant["property_id"],))
            prop = cur.fetchone()
            cur.execute(
                "SELECT COUNT(*) as c FROM tenants WHERE room_id=%s AND user_id != %s AND is_active=1",
                (tenant["room_id"], user["sub"])
            )
            roommates = cur.fetchone()["c"]

        landlord_info = None
        if tenant["landlord_id"]:
            cur.execute(
                "SELECT l.business_name, l.phone, u.name FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s",
                (tenant["landlord_id"],)
            )
            ll = cur.fetchone()
            if ll:
                landlord_info = dict(ll)

        current_month = date.today().strftime('%Y-%m')
        cur.execute(
            "SELECT * FROM rent_payments WHERE tenant_id=%s AND month_year=%s ORDER BY id DESC LIMIT 1",
            (tenant["id"], current_month)
        )
        rent_row = cur.fetchone()

        cur.execute(
            "SELECT COUNT(*) as c FROM maintenance_requests WHERE tenant_id=%s AND status NOT IN ('resolved','closed')",
            (tenant["id"],)
        )
        maintenance_open = cur.fetchone()["c"]

        cur.execute(
            "SELECT COUNT(*) as c FROM complaints WHERE tenant_id=%s AND status='open'",
            (tenant["id"],)
        )
        complaints_open = cur.fetchone()["c"]

        notices_unread = 0
        if tenant["landlord_id"]:
            cur.execute("""
                SELECT COUNT(*) as c FROM notices n
                WHERE n.landlord_id = %s
                AND n.id NOT IN (SELECT notice_id FROM tenant_notice_reads WHERE tenant_id=%s)
            """, (tenant["landlord_id"], tenant["id"]))
            notices_unread = cur.fetchone()["c"]

        return {
            "room": dict(room) if room else None,
            "property": dict(prop) if prop else None,
            "beds_taken": tenant["beds_taken"] or 1,
            "roommates": roommates,
            "move_in_date": tenant["move_in_date"],
            "landlord": landlord_info,
            "current_rent": dict(rent_row) if rent_row else None,
            "maintenance_open": maintenance_open,
            "complaints_open": complaints_open,
            "notices_unread": notices_unread,
        }
    finally:
        conn.close()


@app.get("/my/rent")
def my_rent(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            return []
        cur.execute(
            "SELECT * FROM rent_payments WHERE tenant_id=%s ORDER BY month_year DESC",
            (tenant["id"],),
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/my/rent/{rid}/pay")
async def pay_rent(
    rid: int,
    receipt: Optional[UploadFile] = File(None),
    user=Depends(require_tenant),
):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        cur.execute(
            "SELECT * FROM rent_payments WHERE id=%s AND tenant_id=%s", (rid, tenant["id"])
        )
        rp = cur.fetchone()
        if not rp:
            raise HTTPException(status_code=404, detail="Payment not found")
        if rp["status"] not in ("pending", "overdue"):
            raise HTTPException(status_code=400, detail="Payment is not in a payable state")

        receipt_filename = None
        # Guard against malformed/empty file uploads
        try:
            if receipt and receipt.filename and receipt.filename.strip():
                content = await receipt.read()
                if content:  # only upload if there is actual content
                    result = cloudinary.uploader.upload(
                        content,
                        folder="rentease/receipts_proof",
                        resource_type="auto",
                    )
                    receipt_filename = result["secure_url"]
        except Exception:
            receipt_filename = None

        now = datetime.utcnow().isoformat()
        cur.execute(
            "UPDATE rent_payments SET status='pending_verification', paid_at=%s, receipt_image=%s WHERE id=%s",
            (now, receipt_filename, rid),
        )

        cur.execute("SELECT room_number FROM rooms WHERE id=%s", (rp["room_id"],))
        room = cur.fetchone()
        room_num = room["room_number"] if room else "?"
        create_notification(
            cur, tenant["landlord_id"], "payment",
            f"{tenant['name']} submitted payment for Room {room_num} — Month {rp['month_year']}",
            "/landlord/rent",
        )

        conn.commit()
        cur.execute("SELECT * FROM rent_payments WHERE id=%s", (rid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/my/maintenance")
def my_maintenance(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            return []
        cur.execute(
            "SELECT * FROM maintenance_requests WHERE tenant_id=%s ORDER BY created_at DESC",
            (tenant["id"],),
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/my/maintenance")
async def submit_maintenance(
    title: str = Form(...),
    description: str = Form(""),
    priority: str = Form("medium"),
    photo: Optional[UploadFile] = File(None),
    user=Depends(require_tenant),
):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant or not tenant["room_id"]:
            raise HTTPException(status_code=400, detail="No room assigned")

        photo_filename = None
        if photo and photo.filename:
            content = await photo.read()
            result = cloudinary.uploader.upload(
                content,
                folder="rentease/maintenance",
                resource_type="auto",
            )
            photo_filename = result["secure_url"]

        now = datetime.utcnow().isoformat()
        cur.execute(
            """INSERT INTO maintenance_requests
               (tenant_id,landlord_id,room_id,title,description,priority,status,photo,created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (tenant["id"], tenant["landlord_id"], tenant["room_id"],
             title, description, priority, "open", photo_filename, now),
        )
        mid = cur.fetchone()["id"]

        cur.execute("SELECT room_number FROM rooms WHERE id=%s", (tenant["room_id"],))
        room = cur.fetchone()
        room_num = room["room_number"] if room else "?"
        create_notification(
            cur, tenant["landlord_id"], "maintenance",
            f"New maintenance request from {tenant['name']} in Room {room_num}: {title}",
            "/landlord/maintenance",
        )

        conn.commit()
        cur.execute("SELECT * FROM maintenance_requests WHERE id=%s", (mid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


class MaintenanceUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None


@app.put("/my/maintenance/{mid}")
def update_my_maintenance(mid: int, body: MaintenanceUpdate, user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        cur.execute(
            "SELECT * FROM maintenance_requests WHERE id=%s AND tenant_id=%s", (mid, tenant["id"])
        )
        m = cur.fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Request not found")
        updates = {k: v for k, v in body.dict().items() if v is not None}
        if updates:
            set_clause = ", ".join(f"{k}=%s" for k in updates)
            cur.execute(f"UPDATE maintenance_requests SET {set_clause} WHERE id=%s", list(updates.values()) + [mid])
            conn.commit()
        cur.execute("SELECT * FROM maintenance_requests WHERE id=%s", (mid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/my/complaints")
def my_complaints(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            return []
        cur.execute(
            "SELECT * FROM complaints WHERE tenant_id=%s ORDER BY created_at DESC", (tenant["id"],)
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/my/complaints")
async def submit_complaint(
    title: str = Form(...),
    description: str = Form(""),
    priority: str = Form("medium"),
    photo: Optional[UploadFile] = File(None),
    user=Depends(require_tenant),
):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")

        photo_url = None
        if photo and photo.filename:
            content = await photo.read()
            result = cloudinary.uploader.upload(
                content,
                folder="rentease/complaints",
                resource_type="auto",
            )
            photo_url = result["secure_url"]

        now = datetime.utcnow().isoformat()
        cur.execute(
            "INSERT INTO complaints (tenant_id,landlord_id,title,description,photo_url,status,priority,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (tenant["id"], tenant["landlord_id"], title, description, photo_url, "open", priority or "medium", now),
        )
        cid = cur.fetchone()["id"]

        create_notification(
            cur, tenant["landlord_id"], "complaint",
            f"New complaint from {tenant['name']}: {title}",
            "/landlord/complaints",
        )

        conn.commit()
        cur.execute("SELECT * FROM complaints WHERE id=%s", (cid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AdminResetPasswordRequest(BaseModel):
    new_password: str


@app.put("/admin/users/{uid}/reset-password")
def admin_reset_password(uid: int, body: AdminResetPasswordRequest, user=Depends(require_superadmin)):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, name, role FROM users WHERE id=%s", (uid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(body.new_password), uid))
        # Mark any pending password_reset notifications for this user as read
        link_pattern = None
        if row["role"] == "landlord":
            cur.execute("SELECT id FROM landlords WHERE user_id=%s", (uid,))
            landlord = cur.fetchone()
            if landlord:
                link_pattern = f"/admin/landlords/{landlord['id']}"
        elif row["role"] == "tenant":
            cur.execute("SELECT id FROM tenants WHERE user_id=%s", (uid,))
            tenant = cur.fetchone()
            if tenant:
                link_pattern = f"/admin/tenants?id={tenant['id']}"
                create_tenant_notification(cur, tenant["id"], "account",
                    "Your password has been reset by admin. Please log in with your new password.")
        if link_pattern:
            cur.execute(
                "UPDATE admin_notifications SET is_read=1 WHERE type='password_reset' AND link=%s",
                (link_pattern,)
            )
        conn.commit()
        return {"message": f"Password reset successfully for {row['name']}"}
    finally:
        conn.close()


@app.get("/admin/trigger-overdue-check")
def trigger_overdue_check(test_date: Optional[str] = None):
    """Manually run the overdue rent check. No auth for browser testing."""
    count = check_overdue_rent(test_date=test_date)
    return {"message": f"Marked {count} payment(s) as overdue", "marked_overdue": count}


@app.get("/admin/trigger-auto-rent")
def trigger_auto_rent(day: Optional[int] = None):
    """Manually trigger auto-rent generation for testing. No auth required."""
    check_date = None
    if day is not None:
        try:
            check_date = date.today().replace(day=day)
        except ValueError:
            return {"error": f"Invalid day={day} for current month"}
    count = auto_generate_rent(check_date=check_date)
    return {"generated": count, "check_date": str(check_date or date.today())}


@app.get("/admin/chart/platform-revenue")
def admin_chart_platform_revenue(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT month_year,
                   SUM(CASE WHEN status='paid' THEN amount ELSE 0 END) as collected,
                   SUM(CASE WHEN status='pending' THEN amount ELSE 0 END) as pending,
                   COUNT(DISTINCT landlord_id) as paying_landlords
            FROM platform_payments
            WHERE month_year >= TO_CHAR(NOW() - INTERVAL '5 months', 'YYYY-MM')
            GROUP BY month_year
            ORDER BY month_year ASC
        """)
        rows = cur.fetchall()
        result = []
        for r in rows:
            try:
                label = datetime.strptime(r['month_year'], '%Y-%m').strftime('%b %Y')
            except Exception:
                label = r['month_year']
            result.append({
                "month": label,
                "collected": float(r['collected'] or 0),
                "pending": float(r['pending'] or 0),
                "paying_landlords": int(r['paying_landlords'] or 0),
            })
        return result
    finally:
        conn.close()


@app.get("/admin/chart/landlord-growth")
def admin_chart_landlord_growth(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT TO_CHAR(created_at::timestamp, 'YYYY-MM') as month, COUNT(*) as new_landlords
            FROM landlords
            WHERE created_at::timestamp >= NOW() - INTERVAL '5 months'
            GROUP BY month
            ORDER BY month ASC
        """)
        rows = cur.fetchall()
        result = []
        for r in rows:
            try:
                label = datetime.strptime(r['month'], '%Y-%m').strftime('%b %Y')
            except Exception:
                label = r['month']
            result.append({"month": label, "new_landlords": int(r['new_landlords'] or 0)})
        return result
    finally:
        conn.close()


@app.get("/admin/chart/occupancy")
def admin_chart_occupancy(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT
                COALESCE(SUM(r.max_beds), 0) as total_beds,
                COALESCE(SUM(COALESCE(r.occupied_beds,0)), 0) as occupied,
                COALESCE(SUM(r.max_beds), 0) -
                  COALESCE(SUM(COALESCE(r.occupied_beds,0)), 0) as vacant,
                COUNT(DISTINCT p.landlord_id) as landlords,
                COUNT(DISTINCT p.id) as properties
            FROM rooms r
            JOIN properties p ON r.property_id = p.id
            WHERE p.status = 'approved'
        """)
        row = cur.fetchone()
        return {
            "total_beds": int(row['total_beds'] or 0),
            "occupied": int(row['occupied'] or 0),
            "vacant": int(row['vacant'] or 0),
            "landlords": int(row['landlords'] or 0),
            "properties": int(row['properties'] or 0),
        }
    finally:
        conn.close()


@app.get("/admin/landlords/{lid}/summary-pdf")
def admin_landlord_summary_pdf(lid: int, user=Depends(require_superadmin)):
    buf = generate_landlord_summary_pdf(lid)
    if not buf:
        raise HTTPException(status_code=500, detail="Could not generate PDF — ensure reportlab is installed")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="landlord_summary_{lid}.pdf"'})


@app.get("/admin/export-pdf")
def admin_export_pdf(user=Depends(require_superadmin)):
    buf = generate_admin_report_pdf()
    if not buf:
        raise HTTPException(status_code=500, detail="Could not generate PDF — ensure reportlab is installed")
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="platform_report.pdf"'})


@app.get("/landlord/export-pdf")
def landlord_export_pdf(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    try:
        buf = generate_landlord_export_pdf(lid)
        if not buf:
            raise HTTPException(status_code=500, detail="Could not generate PDF — ensure reportlab is installed")
        return StreamingResponse(buf, media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="property_report.pdf"'})
    except HTTPException:
        raise
    except Exception as e:
        _traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@app.get("/landlord/chart/rent-collection")
def landlord_chart_rent_collection(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        result = []
        today = datetime.utcnow()
        for i in range(5, -1, -1):
            month_dt = (today.replace(day=1) - timedelta(days=1) * (i * 30)).replace(day=1)
            month_str = month_dt.strftime("%Y-%m")
            label = month_dt.strftime("%b %Y")
            cur.execute(
                """SELECT status, COALESCE(SUM(amount),0) as total
                   FROM rent_payments WHERE landlord_id=%s AND month_year=%s
                   GROUP BY status""",
                (lid, month_str)
            )
            rows = cur.fetchall()
            collected = pending = 0
            for r in rows:
                if r["status"] == "paid":
                    collected = float(r["total"] or 0)
                elif r["status"] in ("pending", "pending_verification"):
                    pending += float(r["total"] or 0)
            result.append({"month": label, "collected": collected, "pending": pending})
        return result
    finally:
        conn.close()


@app.get("/landlord/chart/occupancy")
def landlord_chart_occupancy(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id, name FROM properties WHERE landlord_id=%s AND status='approved'", (lid,)
        )
        properties = cur.fetchall()
        result = []
        for p in properties:
            cur.execute(
                "SELECT COALESCE(SUM(max_beds),0) as total, COALESCE(SUM(occupied_beds),0) as occ FROM rooms WHERE property_id=%s",
                (p["id"],)
            )
            totals = cur.fetchone()
            total = int(totals["total"] or 0)
            occ = int(totals["occ"] or 0)
            rate = round((occ / total * 100), 1) if total > 0 else 0
            result.append({"property": p["name"] or "Unnamed", "rate": rate, "occupied": occ, "total": total})
        return result
    finally:
        conn.close()


@app.get("/landlord/chart/revenue")
def landlord_chart_revenue(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        result = []
        today = datetime.utcnow()
        for i in range(5, -1, -1):
            month_dt = (today.replace(day=1) - timedelta(days=1) * (i * 30)).replace(day=1)
            month_str = month_dt.strftime("%Y-%m")
            label = month_dt.strftime("%b %Y")
            cur.execute(
                "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND month_year=%s AND status='paid'",
                (lid, month_str)
            )
            rent = float(scalar(cur) or 0)
            cur.execute(
                "SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE landlord_id=%s AND month_year=%s AND status='paid'",
                (lid, month_str)
            )
            fee = float(scalar(cur) or 0)
            result.append({"month": label, "rent": rent, "fee": fee, "net": rent - fee})
        return result
    finally:
        conn.close()


@app.put("/admin/change-password")
def admin_change_password(body: ChangePasswordRequest, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE id=%s", (user["sub"],))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        if not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(body.new_password), user["sub"]))
        conn.commit()
        return {"message": "Password changed successfully"}
    finally:
        conn.close()


@app.put("/landlord/change-password")
def landlord_change_password(body: ChangePasswordRequest, user=Depends(require_landlord)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE id=%s", (user["sub"],))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        if not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(body.new_password), user["sub"]))
        conn.commit()
        return {"message": "Password changed successfully"}
    finally:
        conn.close()


@app.put("/my/profile/change-password")
def change_password(body: ChangePasswordRequest, user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM users WHERE id=%s", (user["sub"],))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        if not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(body.new_password), user["sub"]))
        conn.commit()
        return {"message": "Password changed successfully"}
    finally:
        conn.close()


@app.get("/my/notifications")
def my_tenant_notifications(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            return []
        cur.execute(
            "SELECT * FROM tenant_notifications WHERE tenant_id=%s ORDER BY created_at DESC LIMIT 50",
            (tenant["id"],),
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/my/notifications/unread-count")
def my_tenant_notifications_count(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            return {"count": 0}
        cur.execute(
            "SELECT COUNT(*) as c FROM tenant_notifications WHERE tenant_id=%s AND is_read=0",
            (tenant["id"],),
        )
        count = cur.fetchone()["c"]
        return {"count": count}
    finally:
        conn.close()


@app.put("/my/notifications/{nid}/read")
def mark_my_notification_read(nid: int, user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        cur.execute("UPDATE tenant_notifications SET is_read=1 WHERE id=%s AND tenant_id=%s", (nid, tenant["id"]))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.put("/my/notifications/read-all")
def mark_all_my_notifications_read(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        cur.execute("UPDATE tenant_notifications SET is_read=1 WHERE tenant_id=%s", (tenant["id"],))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.get("/my/notices")
def my_notices(user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            return []
        cur.execute("""
            SELECT n.*, p.name as property_name,
                   l.business_name as landlord_name,
                   CASE WHEN tnr.id IS NOT NULL THEN 1 ELSE 0 END as is_read
            FROM notices n
            LEFT JOIN properties p ON n.property_id=p.id
            LEFT JOIN landlords l ON n.landlord_id=l.id
            LEFT JOIN tenant_notice_reads tnr ON tnr.notice_id=n.id AND tnr.tenant_id=%s
            WHERE n.landlord_id=%s AND n.is_active=1
              AND (n.property_id IS NULL OR n.property_id=%s)
            ORDER BY n.created_at DESC
        """, (tenant["id"], tenant["landlord_id"], tenant["property_id"]))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/my/notices/{nid}/read")
def mark_notice_read(nid: int, user=Depends(require_tenant)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM tenants WHERE user_id=%s", (user["sub"],))
        tenant = cur.fetchone()
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        try:
            cur.execute(
                "INSERT INTO tenant_notice_reads (tenant_id, notice_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (tenant["id"], nid),
            )
            conn.commit()
        except Exception:
            pass
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# PLATFORM PAYMENTS (ADMIN)
# ═══════════════════════════════════════════════════════════════════════════════

class GeneratePlatformPaymentsRequest(BaseModel):
    month_year: Optional[str] = None


class PlatformPaymentStatusUpdate(BaseModel):
    status: str


@app.get("/admin/platform-payments")
def list_platform_payments(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT pp.*, l.business_name, u.email
            FROM platform_payments pp
            JOIN landlords l ON pp.landlord_id=l.id
            JOIN users u ON l.user_id=u.id
            ORDER BY pp.month_year DESC, pp.created_at DESC
        """)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/admin/platform-payments/generate")
def generate_platform_payments(body: GeneratePlatformPaymentsRequest, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        month_year = body.month_year or datetime.utcnow().strftime("%Y-%m")
        year, month = map(int, month_year.split("-"))
        due_date = f"{year}-{month:02d}-05"
        cur.execute(
            "SELECT * FROM landlords WHERE is_approved=1 AND is_deleted=0 AND monthly_fee > 0"
        )
        landlords = cur.fetchall()
        created = 0
        now = datetime.utcnow().isoformat()
        for l in landlords:
            cur.execute(
                "SELECT id FROM platform_payments WHERE landlord_id=%s AND month_year=%s",
                (l["id"], month_year),
            )
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO platform_payments (landlord_id,amount,month_year,status,due_date,created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                    (l["id"], l["monthly_fee"], month_year, "pending", due_date, now),
                )
                created += 1
        conn.commit()
        return {"created": created, "month_year": month_year}
    finally:
        conn.close()


@app.put("/admin/platform-payments/{pid}/status")
def update_platform_payment_status(pid: int, body: PlatformPaymentStatusUpdate, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM platform_payments WHERE id=%s", (pid,))
        pp = cur.fetchone()
        if not pp:
            raise HTTPException(status_code=404, detail="Payment not found")
        now = datetime.utcnow().isoformat()
        paid_at = now if body.status == "paid" else None
        cur.execute(
            "UPDATE platform_payments SET status=%s, paid_at=%s WHERE id=%s",
            (body.status, paid_at, pid),
        )
        conn.commit()
        cur.execute("SELECT * FROM platform_payments WHERE id=%s", (pid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


class VerifyPlatformPaymentRequest(BaseModel):
    action: str  # 'confirm' or 'reject'


@app.put("/admin/platform-payments/{pid}/verify")
def verify_platform_payment(pid: int, body: VerifyPlatformPaymentRequest, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT * FROM platform_payments WHERE id=%s", (pid,))
        pp = cur.fetchone()
        if not pp:
            raise HTTPException(status_code=404, detail="Payment not found")
        if body.action == "confirm":
            now = datetime.utcnow().isoformat()
            cur.execute("UPDATE platform_payments SET status='paid', paid_at=%s WHERE id=%s", (now, pid))
        elif body.action == "reject":
            cur.execute("UPDATE platform_payments SET status='pending', paid_at=NULL WHERE id=%s", (pid,))
        else:
            raise HTTPException(status_code=400, detail="action must be 'confirm' or 'reject'")
        conn.commit()
        cur.execute("SELECT * FROM platform_payments WHERE id=%s", (pid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# ADMIN NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/admin/notifications/unread-count")
def admin_notifications_unread_count(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("SELECT COUNT(*) as c FROM admin_notifications WHERE is_read=0")
        count = cur.fetchone()["c"]
        return {"count": count}
    finally:
        conn.close()


@app.get("/admin/notifications")
def get_admin_notifications(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM admin_notifications ORDER BY created_at DESC LIMIT 50"
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/admin/notifications/read-all")
def mark_all_admin_notifications_read(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE admin_notifications SET is_read=1")
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


@app.put("/admin/notifications/{nid}/read")
def mark_admin_notification_read(nid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("UPDATE admin_notifications SET is_read=1 WHERE id=%s", (nid,))
        conn.commit()
        return {"success": True}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# ADMIN REVENUE & HISTORY
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/admin/pending-approvals")
def admin_pending_approvals(user=Depends(require_superadmin)):
    """Returns pending landlords and pending properties for the dashboard modal."""
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.id, l.business_name, l.monthly_fee, l.created_at,
                   u.name, u.email
            FROM landlords l JOIN users u ON l.user_id=u.id
            WHERE l.status='pending' AND COALESCE(l.is_deleted,0)=0
            ORDER BY u.name ASC
        """)
        landlords = cur.fetchall()
        cur.execute("""
            SELECT p.id, p.name, p.property_type, p.category, p.created_at,
                   u.name as landlord_name
            FROM properties p
            JOIN landlords l ON p.landlord_id=l.id
            JOIN users u ON l.user_id=u.id
            WHERE p.status='pending_approval'
            ORDER BY p.name ASC
        """)
        properties = cur.fetchall()
        return {
            "pending_landlords": [dict(r) for r in landlords],
            "pending_properties": [dict(r) for r in properties],
        }
    finally:
        conn.close()


@app.get("/admin/landlords/{lid}/rent")
def admin_landlord_rent(lid: int, month_year: Optional[str] = None, user=Depends(require_superadmin)):
    my = month_year or datetime.utcnow().strftime("%Y-%m")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT rp.*, t.name as tenant_name, r.room_number, p.name as property_name
            FROM rent_payments rp
            JOIN tenants t ON rp.tenant_id=t.id
            JOIN rooms r ON rp.room_id=r.id
            LEFT JOIN properties p ON r.property_id=p.id
            WHERE rp.landlord_id=%s AND rp.month_year=%s
            ORDER BY t.name
        """, (lid, my))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/admin/tenant-history")
def admin_tenant_history(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT t.id, t.name, t.email, t.phone, t.cnic, t.move_in_date,
                   t.is_active, t.deactivated_by_landlord, 'active' as record_type, NULL as deleted_at,
                   u_l.name as landlord_name, l.status as landlord_status,
                   r.room_number, p.name as property_name
            FROM tenants t
            JOIN landlords l ON t.landlord_id=l.id
            JOIN users u_l ON l.user_id=u_l.id
            LEFT JOIN rooms r ON t.room_id=r.id
            LEFT JOIN properties p ON t.property_id=p.id
            WHERE COALESCE(l.is_deleted,0)=0
            ORDER BY t.name ASC
        """)
        active = cur.fetchall()
        deleted = []
        try:
            cur.execute("""
                SELECT al.id, al.name, al.email, al.phone, al.cnic, al.move_in_date,
                       0 as is_active, 'deleted' as record_type, al.deleted_at,
                       COALESCE(u_l.name, 'Unknown') as landlord_name,
                       NULL as room_number, NULL as property_name
                FROM tenant_audit_log al
                LEFT JOIN landlords l ON al.landlord_id=l.id
                LEFT JOIN users u_l ON l.user_id=u_l.id
                ORDER BY al.deleted_at DESC
                LIMIT 200
            """)
            deleted = cur.fetchall()
        except Exception:
            pass
        return {"active": [dict(r) for r in active], "deleted": [dict(r) for r in deleted]}
    finally:
        conn.close()


@app.get("/admin/history/{lid}/detail")
def admin_history_landlord_detail(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.*, u.name, u.email as user_email, u.is_active
            FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s
        """, (lid,))
        landlord = cur.fetchone()
        if not landlord:
            raise HTTPException(status_code=404, detail="Landlord not found")
        cur.execute("""
            SELECT p.id, p.name, p.address, p.property_type,
                   COALESCE(p.status,'approved') as status,
                   COUNT(r.id) as total_rooms
            FROM properties p LEFT JOIN rooms r ON r.property_id=p.id
            WHERE p.landlord_id=%s GROUP BY p.id ORDER BY p.created_at DESC
        """, (lid,))
        properties = cur.fetchall()
        cur.execute("""
            SELECT t.id, t.name, t.email, t.phone, t.move_in_date, t.is_active,
                   r.room_number, p.name as property_name
            FROM tenants t
            LEFT JOIN rooms r ON t.room_id=r.id
            LEFT JOIN properties p ON t.property_id=p.id
            WHERE t.landlord_id=%s ORDER BY t.created_at DESC
        """, (lid,))
        tenants = cur.fetchall()
        deleted_tenants = []
        try:
            cur.execute(
                "SELECT * FROM tenant_audit_log WHERE landlord_id=%s ORDER BY deleted_at DESC",
                (lid,)
            )
            deleted_tenants = cur.fetchall()
        except Exception:
            pass
        cur.execute(
            "SELECT * FROM platform_payments WHERE landlord_id=%s ORDER BY month_year DESC LIMIT 24", (lid,)
        )
        payments = cur.fetchall()
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM platform_payments WHERE landlord_id=%s AND status='paid'", (lid,)
        )
        total_platform_paid = scalar(cur)
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) FROM rent_payments WHERE landlord_id=%s AND status='paid'", (lid,)
        )
        total_rent_revenue = scalar(cur)
        return {
            "landlord": dict(landlord),
            "properties": [dict(p) for p in properties],
            "tenants": [dict(t) for t in tenants],
            "deleted_tenants": [dict(t) for t in deleted_tenants],
            "platform_payments": [dict(p) for p in payments],
            "total_platform_fees_paid": float(total_platform_paid),
            "total_rent_revenue": float(total_rent_revenue),
        }
    finally:
        conn.close()


@app.get("/admin/landlords/history")
def admin_landlords_history(user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.id, l.business_name, l.status,
                   COALESCE(l.monthly_fee, 0) as monthly_fee,
                   COALESCE(l.is_deleted, 0) as is_deleted,
                   l.deleted_at, l.created_at,
                   u.name, u.email, u.is_active,
                   COALESCE((SELECT SUM(amount) FROM platform_payments WHERE landlord_id=l.id AND status='paid'),0) as fees_paid,
                   (SELECT COUNT(*) FROM properties WHERE landlord_id=l.id) as property_count,
                   (SELECT COUNT(*) FROM tenants WHERE landlord_id=l.id) as tenant_count
            FROM landlords l JOIN users u ON l.user_id=u.id
            ORDER BY u.name ASC
        """)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"[admin_landlords_history] ERROR: {e}")
        return []
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — PROFIT REPORT
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/reports/profit")
def profit_report(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM rent_payments WHERE landlord_id=%s AND status='paid'",
            (lid,),
        )
        total_revenue = cur.fetchone()["s"]

        cur.execute(
            "SELECT COALESCE(SUM(amount),0) as s FROM platform_payments WHERE landlord_id=%s AND status='paid'",
            (lid,),
        )
        total_fees = cur.fetchone()["s"]

        cur.execute(
            """SELECT month_year, COALESCE(SUM(amount),0) as collected
               FROM rent_payments WHERE landlord_id=%s AND status='paid'
               GROUP BY month_year ORDER BY month_year DESC LIMIT 12""",
            (lid,),
        )
        rent_months = cur.fetchall()

        monthly_breakdown = []
        for r in rent_months:
            cur.execute(
                "SELECT COALESCE(SUM(amount),0) as s FROM platform_payments WHERE landlord_id=%s AND month_year=%s AND status='paid'",
                (lid, r["month_year"]),
            )
            fee = cur.fetchone()["s"]
            monthly_breakdown.append({
                "month_year": r["month_year"],
                "rent_collected": r["collected"],
                "platform_fee": fee,
                "net_profit": r["collected"] - fee,
            })

        return {
            "total_revenue": total_revenue,
            "total_platform_fees": total_fees,
            "net_profit": total_revenue - total_fees,
            "monthly_breakdown": list(reversed(monthly_breakdown)),
        }
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════════════════════
# LANDLORD — PLATFORM FEE
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/landlord/platform-fee")
def landlord_platform_fee(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    current_month = datetime.utcnow().strftime("%Y-%m")
    fallback = {
        "monthly_fee": 0,
        "current_month": current_month,
        "current_month_status": None,
        "current_month_payment_id": None,
        "history": [],
    }
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Safely get monthly_fee (column added via migration — may not exist on old DB)
        try:
            cur.execute("SELECT monthly_fee FROM landlords WHERE id=%s", (lid,))
            row = cur.fetchone()
            monthly_fee = float(row["monthly_fee"]) if row and row["monthly_fee"] else 0.0
        except Exception as e:
            print(f"[platform-fee] monthly_fee query failed: {e}")
            monthly_fee = 0.0

        # Safely query platform_payments (table may not exist yet)
        try:
            cur.execute(
                "SELECT * FROM platform_payments WHERE landlord_id=%s AND month_year=%s",
                (lid, current_month),
            )
            current = cur.fetchone()
            cur.execute(
                "SELECT * FROM platform_payments WHERE landlord_id=%s ORDER BY month_year DESC",
                (lid,),
            )
            history = cur.fetchall()
        except Exception as e:
            print(f"[platform-fee] platform_payments query failed: {e}")
            current = None
            history = []

        return {
            "monthly_fee": monthly_fee,
            "current_month": current_month,
            "current_month_status": current["status"] if current else None,
            "current_month_payment_id": current["id"] if current else None,
            "history": [dict(r) for r in history],
        }
    except Exception as e:
        print(f"[platform-fee] FATAL: {e}")
        return fallback
    finally:
        conn.close()


class InquiryRequest(BaseModel):
    name: str
    email: str
    phone: str
    message: Optional[str] = ""

class RejectListingRequest(BaseModel):
    reason: str


@app.put("/landlord/platform-fee/{pid}/pay")
def landlord_mark_platform_fee_paid(pid: int, user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM platform_payments WHERE id=%s AND landlord_id=%s", (pid, lid)
        )
        pp = cur.fetchone()
        if not pp:
            raise HTTPException(status_code=404, detail="Payment record not found")
        if pp["status"] in ("paid", "pending_verification"):
            raise HTTPException(status_code=400, detail="Already submitted or paid")
        now = datetime.utcnow().isoformat()
        cur.execute(
            "UPDATE platform_payments SET status='pending_verification', paid_at=%s WHERE id=%s", (now, pid)
        )
        # Notify admin
        cur.execute(
            "SELECT u.name FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s", (pp["landlord_id"],)
        )
        landlord_row = cur.fetchone()
        landlord_name = landlord_row["name"] if landlord_row else "Unknown"
        create_admin_notification(
            cur, "platform_fee",
            f"Platform fee submitted · {landlord_name} · {pp['month_year']}",
            "/admin/revenue",
        )
        conn.commit()
        cur.execute("SELECT * FROM platform_payments WHERE id=%s", (pid,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


# ── PUBLIC LISTINGS ───────────────────────────────────────────────────────────

@app.get("/listings")
def public_list_listings():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.id, l.title, l.description, l.created_at,
                   p.name as property_name, p.address, p.category,
                   u.name as landlord_name,
                   la.phone as landlord_phone,
                   u.email as landlord_email,
                   (SELECT photo_url FROM listing_photos
                    WHERE listing_id=l.id AND is_primary=1
                    LIMIT 1) as primary_photo,
                   COUNT(DISTINCT r.id) as total_rooms,
                   COALESCE(SUM(r.max_beds - COALESCE(r.occupied_beds,0)), 0) as available_beds,
                   MIN(r.price_per_bed) as min_price,
                   MAX(r.price_per_bed) as max_price
            FROM listings l
            JOIN properties p ON l.property_id = p.id
            JOIN landlords la ON l.landlord_id = la.id
            JOIN users u ON la.user_id = u.id
            LEFT JOIN rooms r ON r.property_id = p.id
            WHERE l.status = 'approved'
            GROUP BY l.id, p.name, p.address, p.category, u.name, la.phone, u.email
            ORDER BY l.created_at DESC
        """)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/listings/{lid}")
def public_get_listing(lid: int):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.id, l.title, l.description, l.created_at,
                   p.id as property_id, p.name as property_name, p.address, p.category,
                   u.name as landlord_name,
                   la.phone as landlord_phone,
                   u.email as landlord_email,
                   COUNT(DISTINCT r.id) as total_rooms,
                   COALESCE(SUM(r.max_beds - COALESCE(r.occupied_beds,0)), 0) as available_beds,
                   MIN(r.price_per_bed) as min_price,
                   MAX(r.price_per_bed) as max_price
            FROM listings l
            JOIN properties p ON l.property_id = p.id
            JOIN landlords la ON l.landlord_id = la.id
            JOIN users u ON la.user_id = u.id
            LEFT JOIN rooms r ON r.property_id = p.id
            WHERE l.id = %s AND l.status = 'approved'
            GROUP BY l.id, p.id, p.name, p.address, p.category, u.name, la.phone, u.email
        """, (lid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        result = dict(row)
        cur.execute(
            "SELECT * FROM listing_photos WHERE listing_id=%s ORDER BY is_primary DESC, id ASC",
            (lid,)
        )
        photos = cur.fetchall()
        result["photos"] = [dict(p) for p in photos]
        cur.execute("""
            SELECT room_number, max_beds,
                   COALESCE(occupied_beds,0) as occupied,
                   max_beds - COALESCE(occupied_beds,0) as available,
                   price_per_bed, status
            FROM rooms WHERE property_id=%s
            ORDER BY room_number ASC
        """, (result["property_id"],))
        all_rooms = cur.fetchall()
        result["rooms"] = [dict(r) for r in all_rooms if dict(r)["available"] > 0]
        return result
    finally:
        conn.close()


@app.post("/listings/{lid}/inquire")
def public_inquire(lid: int, body: InquiryRequest):
    if not body.name.strip() or not body.email.strip() or not body.phone.strip():
        raise HTTPException(status_code=400, detail="Name, email, and phone are required")
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.*, p.name as property_name, la.id as la_id
            FROM listings l
            JOIN properties p ON l.property_id=p.id
            JOIN landlords la ON l.landlord_id=la.id
            WHERE l.id=%s AND l.status='approved'
        """, (lid,))
        listing = cur.fetchone()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        cur.execute(
            "INSERT INTO listing_inquiries (listing_id, name, email, phone, message) VALUES (%s,%s,%s,%s,%s)",
            (lid, body.name.strip(), body.email.strip(), body.phone.strip(), body.message or "")
        )
        msg = f"New inquiry for {listing['property_name']} from {body.name} · {body.phone} · {body.email}"
        create_notification(cur, listing["la_id"], "inquiry", msg, "/landlord/listings")
        conn.commit()
        return {"message": "Inquiry sent successfully"}
    finally:
        conn.close()


# ── LANDLORD LISTINGS ─────────────────────────────────────────────────────────

@app.get("/landlord/listings")
def landlord_list_listings(user=Depends(require_landlord)):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.*, p.name as property_name,
                   (SELECT photo_url FROM listing_photos
                    WHERE listing_id=l.id AND is_primary=1 LIMIT 1) as primary_photo,
                   COUNT(DISTINCT lp.id) as photos_count,
                   COUNT(DISTINCT li.id) as inquiries_count
            FROM listings l
            JOIN properties p ON l.property_id=p.id
            LEFT JOIN listing_photos lp ON lp.listing_id=l.id
            LEFT JOIN listing_inquiries li ON li.listing_id=l.id
            WHERE l.landlord_id=%s
            GROUP BY l.id, p.name
            ORDER BY l.created_at DESC
        """, (lid,))
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/landlord/listings")
async def landlord_create_listing(
    property_id: int = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    photos: List[UploadFile] = File(default=[]),
    user=Depends(require_landlord),
):
    lid = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM properties WHERE id=%s AND landlord_id=%s AND status='approved'",
            (property_id, lid)
        )
        prop = cur.fetchone()
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found or not approved")
        now = datetime.utcnow().isoformat()
        cur.execute("""
            INSERT INTO listings (property_id, landlord_id, title, description, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'pending', %s, %s) RETURNING id
        """, (property_id, lid, title.strip(), description.strip(), now, now))
        listing_id = cur.fetchone()["id"]
        saved = 0
        for photo in (photos or [])[:5]:
            if not photo or not photo.filename:
                continue
            content = await photo.read()
            if not content:
                continue
            result = cloudinary.uploader.upload(
                content,
                folder=f"rentease/listings/{listing_id}",
                resource_type="auto",
            )
            photo_url = result["secure_url"]
            cur.execute(
                "INSERT INTO listing_photos (listing_id, photo_url, is_primary) VALUES (%s,%s,%s)",
                (listing_id, photo_url, 1 if saved == 0 else 0)
            )
            saved += 1
        cur.execute(
            "SELECT u.name FROM landlords l JOIN users u ON l.user_id=u.id WHERE l.id=%s", (lid,)
        )
        landlord_row = cur.fetchone()
        landlord_name = landlord_row["name"] if landlord_row else "Unknown"
        create_admin_notification(
            cur, "listing",
            f"New listing · {prop['name']} by {landlord_name}",
            "/admin/listings",
        )
        conn.commit()
        cur.execute("SELECT * FROM listings WHERE id=%s", (listing_id,))
        row = cur.fetchone()
        return dict(row)
    finally:
        conn.close()


@app.delete("/landlord/listings/photos/{pid}")
def landlord_delete_photo(pid: int, user=Depends(require_landlord)):
    landlord_id = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT lp.* FROM listing_photos lp
            JOIN listings l ON lp.listing_id=l.id
            WHERE lp.id=%s AND l.landlord_id=%s
        """, (pid, landlord_id))
        photo = cur.fetchone()
        if not photo:
            raise HTTPException(status_code=404, detail="Photo not found")
        public_id = _cloudinary_public_id_from_url(photo["photo_url"])
        if public_id:
            try:
                cloudinary.uploader.destroy(public_id, resource_type="image")
            except Exception:
                pass
        was_primary = photo["is_primary"]
        listing_id = photo["listing_id"]
        cur.execute("DELETE FROM listing_photos WHERE id=%s", (pid,))
        if was_primary:
            cur.execute(
                "SELECT id FROM listing_photos WHERE listing_id=%s LIMIT 1", (listing_id,)
            )
            next_p = cur.fetchone()
            if next_p:
                cur.execute("UPDATE listing_photos SET is_primary=1 WHERE id=%s", (next_p["id"],))
        conn.commit()
        return {"message": "Photo deleted"}
    finally:
        conn.close()


@app.delete("/landlord/listings/{lid}")
def landlord_delete_listing(lid: int, user=Depends(require_landlord)):
    landlord_id = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM listings WHERE id=%s AND landlord_id=%s", (lid, landlord_id)
        )
        listing = cur.fetchone()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        cur.execute(
            "SELECT photo_url FROM listing_photos WHERE listing_id=%s", (lid,)
        )
        photos = cur.fetchall()
        for p in photos:
            public_id = _cloudinary_public_id_from_url(p["photo_url"])
            if public_id:
                try:
                    cloudinary.uploader.destroy(public_id, resource_type="image")
                except Exception:
                    pass
        cur.execute("DELETE FROM listing_photos WHERE listing_id=%s", (lid,))
        cur.execute("DELETE FROM listing_inquiries WHERE listing_id=%s", (lid,))
        cur.execute("DELETE FROM listings WHERE id=%s", (lid,))
        conn.commit()
        return {"message": "Listing deleted"}
    finally:
        conn.close()


@app.get("/landlord/listings/{lid}/inquiries")
def landlord_get_inquiries(lid: int, user=Depends(require_landlord)):
    landlord_id = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id FROM listings WHERE id=%s AND landlord_id=%s", (lid, landlord_id)
        )
        listing = cur.fetchone()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        cur.execute(
            "SELECT * FROM listing_inquiries WHERE listing_id=%s ORDER BY created_at DESC",
            (lid,)
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.put("/landlord/listings/inquiries/{iid}/contact")
def toggle_inquiry_contacted(iid: int, user=Depends(require_landlord)):
    landlord_id = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT li.* FROM listing_inquiries li
            JOIN listings l ON li.listing_id=l.id
            WHERE li.id=%s AND l.landlord_id=%s
        """, (iid, landlord_id))
        inq = cur.fetchone()
        if not inq:
            raise HTTPException(status_code=404, detail="Inquiry not found")
        new_val = 0 if inq["contacted"] else 1
        cur.execute("UPDATE listing_inquiries SET contacted=%s WHERE id=%s", (new_val, iid))
        conn.commit()
        return {"id": iid, "contacted": new_val}
    finally:
        conn.close()


@app.get("/landlord/listings/{lid}/photos")
def landlord_get_photos(lid: int, user=Depends(require_landlord)):
    landlord_id = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT id FROM listings WHERE id=%s AND landlord_id=%s", (lid, landlord_id)
        )
        listing = cur.fetchone()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        cur.execute(
            "SELECT * FROM listing_photos WHERE listing_id=%s ORDER BY is_primary DESC, id ASC",
            (lid,)
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/landlord/listings/{lid}/photos")
async def landlord_add_photos(
    lid: int,
    photos: List[UploadFile] = File(...),
    user=Depends(require_landlord),
):
    landlord_id = user["landlord_id"]
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM listings WHERE id=%s AND landlord_id=%s", (lid, landlord_id)
        )
        listing = cur.fetchone()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        cur.execute(
            "SELECT COUNT(*) FROM listing_photos WHERE listing_id=%s", (lid,)
        )
        current_count = scalar(cur)
        slots = 5 - current_count
        if slots <= 0:
            raise HTTPException(status_code=400, detail="Maximum 5 photos per listing reached")
        saved = 0
        for photo in photos[:slots]:
            if not photo or not photo.filename:
                continue
            content = await photo.read()
            if not content:
                continue
            result = cloudinary.uploader.upload(
                content,
                folder=f"rentease/listings/{lid}",
                resource_type="auto",
            )
            photo_url = result["secure_url"]
            is_primary = 1 if current_count + saved == 0 else 0
            cur.execute(
                "INSERT INTO listing_photos (listing_id, photo_url, is_primary) VALUES (%s,%s,%s)",
                (lid, photo_url, is_primary)
            )
            saved += 1
        conn.commit()
        cur.execute(
            "SELECT * FROM listing_photos WHERE listing_id=%s ORDER BY is_primary DESC, id ASC",
            (lid,)
        )
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── ADMIN LISTINGS ────────────────────────────────────────────────────────────

@app.get("/admin/listings")
def admin_list_listings(status: Optional[str] = None, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        query = """
            SELECT l.*, p.name as property_name, p.address, p.category,
                   u.name as landlord_name,
                   COUNT(DISTINCT lp.id) as photos_count,
                   COUNT(DISTINCT li.id) as inquiries_count
            FROM listings l
            JOIN properties p ON l.property_id=p.id
            JOIN landlords la ON l.landlord_id=la.id
            JOIN users u ON la.user_id=u.id
            LEFT JOIN listing_photos lp ON lp.listing_id=l.id
            LEFT JOIN listing_inquiries li ON li.listing_id=l.id
        """
        params = []
        if status and status != "all":
            query += " WHERE l.status=%s"
            params.append(status)
        query += " GROUP BY l.id, p.name, p.address, p.category, u.name ORDER BY l.created_at DESC"
        cur.execute(query, params)
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            cur.execute(
                "SELECT * FROM listing_photos WHERE listing_id=%s ORDER BY is_primary DESC, id ASC",
                (d["id"],)
            )
            photos = cur.fetchall()
            d["photos"] = [dict(p) for p in photos]
            result.append(d)
        return result
    finally:
        conn.close()


@app.get("/admin/listings/{lid}")
def admin_get_listing_detail(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.*, p.name as property_name, p.address, p.category,
                   p.id as prop_id, u.name as landlord_name
            FROM listings l
            JOIN properties p ON l.property_id=p.id
            JOIN landlords la ON l.landlord_id=la.id
            JOIN users u ON la.user_id=u.id
            WHERE l.id=%s
        """, (lid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Listing not found")
        result = dict(row)
        cur.execute(
            "SELECT * FROM listing_photos WHERE listing_id=%s ORDER BY is_primary DESC, id ASC", (lid,)
        )
        photos = cur.fetchall()
        result["photos"] = [dict(p) for p in photos]
        cur.execute("""
            SELECT r.room_number, r.max_beds, r.price_per_bed,
                   r.max_beds - COALESCE(SUM(CASE WHEN t.is_active=1 THEN t.beds_taken ELSE 0 END), 0) AS available
            FROM rooms r
            LEFT JOIN tenants t ON t.room_id=r.id
            WHERE r.property_id=%s
            GROUP BY r.id
        """, (result["prop_id"],))
        rooms = cur.fetchall()
        result["rooms"] = [dict(r) for r in rooms if dict(r)["available"] > 0]
        return result
    finally:
        conn.close()


@app.put("/admin/listings/{lid}/approve")
def admin_approve_listing(lid: int, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.*, p.name as property_name, la.id as la_id
            FROM listings l
            JOIN properties p ON l.property_id=p.id
            JOIN landlords la ON l.landlord_id=la.id
            WHERE l.id=%s
        """, (lid,))
        listing = cur.fetchone()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        now = datetime.utcnow().isoformat()
        cur.execute("UPDATE listings SET status='approved', updated_at=%s WHERE id=%s", (now, lid))
        create_notification(
            cur, listing["la_id"], "listing",
            f"Listing approved · {listing['property_name']} is now live!",
            "/landlord/listings",
        )
        conn.commit()
        return {"message": "Listing approved"}
    finally:
        conn.close()


@app.put("/admin/listings/{lid}/reject")
def admin_reject_listing(lid: int, body: RejectListingRequest, user=Depends(require_superadmin)):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT l.*, p.name as property_name, la.id as la_id
            FROM listings l
            JOIN properties p ON l.property_id=p.id
            JOIN landlords la ON l.landlord_id=la.id
            WHERE l.id=%s
        """, (lid,))
        listing = cur.fetchone()
        if not listing:
            raise HTTPException(status_code=404, detail="Listing not found")
        now = datetime.utcnow().isoformat()
        cur.execute("UPDATE listings SET status='rejected', updated_at=%s WHERE id=%s", (now, lid))
        create_notification(
            cur, listing["la_id"], "listing",
            f"Listing rejected · {listing['property_name']} · {body.reason}",
            "/landlord/listings",
        )
        conn.commit()
        return {"message": "Listing rejected"}
    finally:
        conn.close()
