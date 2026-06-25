"""
Seed the demo payer ground-truth data (members, coverage, claims, prior auths).

SCHEMA is owned by Alembic — run `alembic upgrade head` first (this script only
inserts rows; it no longer creates tables). The seeded rows are the REAL data the
agent's tools query at runtime — the agent does not get canned answers; it must
call tools that hit these tables.

Run with:  alembic upgrade head && python scripts/setup_db.py   (from backend/)
"""
from __future__ import annotations

import asyncio
import ssl
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402

MEMBERS = [
    ("W2049-88147", "Maria Alvarez", "1984-03-22", "Aetna", "AET-114", "Open Access PPO", "7741-A"),
    ("UHG-553-22019", "James Whitfield", "1971-11-09", "UnitedHealthcare", "UHC-208", "Choice Plus POS", "UHC-5521"),
    ("CIG-771-40682", "Priya Nair", "1990-07-30", "Cigna", "CIG-330", "Open Access Plus", "CIG-9043"),
    ("BCBS-220-77451", "Devon Carter", "1978-02-14", "BCBS", "BCBS-101", "Blue PPO", "BC-3320"),
    ("HUM-664-10298", "Alicia Romero", "1965-09-05", "Humana", "HUM-410", "Gold Plus HMO", "HU-7781"),
]

COVERAGE = [
    ("W2049-88147", True, "2026-01-01", 25, 40, 1500, 640, 6000, 1180),
    ("UHG-553-22019", True, "2026-01-01", 30, 50, 2000, 2000, 7500, 4200),
    ("CIG-771-40682", True, "2026-01-01", 20, 45, 1000, 300, 5000, 900),
    ("BCBS-220-77451", True, "2026-01-01", 25, 45, 1750, 1750, 6500, 3100),
    ("HUM-664-10298", True, "2026-01-01", 0, 35, 0, 0, 4500, 1500),
]

CLAIMS = [
    ("4471-A", "UHG-553-22019", "2026-04-18", 432.0, "99214", "DENIED", "CARC 16",
     "Referring provider NPI missing in box 17b (missing/incomplete information).",
     "Submit corrected claim, frequency code 7, with referring NPI added.", "2026-10-18"),
    ("HUM-9920", "HUM-664-10298", "2026-03-02", 1875.5, "29881", "DENIED", "CARC 197",
     "Precertification/authorization absent for procedure.",
     "File appeal with retro-auth request and operative note.", "2026-09-02"),
    ("BCBS-5512", "BCBS-220-77451", "2026-05-09", 210.0, "99213", "PAID", None, None, None, None),
]

PRIOR_AUTHS = [
    ("PA-88210", "CIG-771-40682", "70553", "PENDING",
     "Conservative treatment history not documented for the headache indication.",
     "Medical director — peer-to-peer review required.", None),
    ("PA-44115", "BCBS-220-77451", "73721", "APPROVED", None, "Auto-approved per clinical criteria.", "APPROVED"),
]


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def main() -> None:
    conn = await asyncpg.connect(dsn=settings.connection_string(), ssl=_ssl_context())
    try:
        print("Seeding members…  (schema must already exist — run `alembic upgrade head`)")
        for m in MEMBERS:
            await conn.execute(
                """INSERT INTO members(member_id,name,dob,payer,payer_id,plan_type,group_number)
                   VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (member_id) DO NOTHING""",
                m[0], m[1], _date(m[2]), m[3], m[4], m[5], m[6],
            )
        for c in COVERAGE:
            await conn.execute(
                """INSERT INTO coverage(member_id,active,effective_date,copay_pcp,copay_spec,deductible_total,deductible_met,oop_max,oop_met)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (member_id) DO NOTHING""",
                c[0], c[1], _date(c[2]), *c[3:],
            )
        for c in CLAIMS:
            await conn.execute(
                """INSERT INTO claims(claim_id,member_id,dos,billed_amount,cpt,status,carc_code,denial_reason,resubmission_path,timely_filing_deadline)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (claim_id) DO NOTHING""",
                c[0], c[1], _date(c[2]), c[3], c[4], c[5], c[6], c[7], c[8], _date(c[9]),
            )
        for p in PRIOR_AUTHS:
            await conn.execute(
                """INSERT INTO prior_auths(auth_id,member_id,cpt,status,clinical_criteria_unmet,reviewer,determination)
                   VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (auth_id) DO NOTHING""",
                *p,
            )

        counts = await conn.fetchrow(
            """SELECT (SELECT count(*) FROM members) AS members,
                      (SELECT count(*) FROM claims) AS claims,
                      (SELECT count(*) FROM prior_auths) AS prior_auths"""
        )
        print("Seed complete:", dict(counts))
    finally:
        await conn.close()


def _date(value):
    """Parse an ISO date string to a date for asyncpg DATE columns (None passthrough)."""
    if value is None:
        return None
    from datetime import date

    y, m, d = (int(x) for x in value.split("-"))
    return date(y, m, d)


if __name__ == "__main__":
    asyncio.run(main())
