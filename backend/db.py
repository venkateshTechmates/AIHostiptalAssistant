"""SQLite-backed knowledge store + orchestrator persistence for the kiosk.

- Departments/doctors/FAQs come from `excel_loader` (Excel pipeline) with a
  hardcoded fallback to `seed_data.py`.
- FTS5 powers vectorless RAG over multilingual FAQ content.
- New tables `conversations` (session history) and `response_cache` are used
  by the AI orchestrator to persist context and short-circuit repeat queries.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from excel_loader import DEPARTMENTS, DOCTORS, FAQS

DB_PATH = Path(__file__).with_name("kiosk.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS departments (
            id          TEXT PRIMARY KEY,
            map_id      TEXT NOT NULL,
            floor       INTEGER NOT NULL,
            name        TEXT NOT NULL,        -- JSON {lang: str}
            directions  TEXT NOT NULL,        -- JSON {lang: str}
            aliases     TEXT NOT NULL         -- JSON {lang: [str]}
        );

        CREATE TABLE IF NOT EXISTS doctors (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,    -- JSON {lang: str}
            specialty       TEXT NOT NULL,    -- JSON {lang: str}
            specialty_keys  TEXT NOT NULL,    -- JSON [str]
            room            TEXT NOT NULL,
            slots_today     TEXT NOT NULL     -- JSON [str]
        );

        CREATE TABLE IF NOT EXISTS faqs (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            q       TEXT NOT NULL,            -- JSON {lang: str}
            a       TEXT NOT NULL,            -- JSON {lang: str}
            tags    TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS faqs_fts USING fts5(
            content, faq_id UNINDEXED, tokenize = 'unicode61'
        );

        CREATE TABLE IF NOT EXISTS staff_alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kiosk_id    TEXT,
            intent      TEXT,
            language    TEXT,
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
            payload     TEXT
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kiosk_id    TEXT,
            session_id  TEXT,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            language    TEXT,
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_conv_session
            ON conversations (kiosk_id, session_id, id);

        CREATE TABLE IF NOT EXISTS response_cache (
            cache_key    TEXT PRIMARY KEY,
            reply        TEXT NOT NULL,
            intent       TEXT,
            options      TEXT,
            map_target   TEXT,
            alert        INTEGER DEFAULT 0,
            data         TEXT,
            hit_count    INTEGER DEFAULT 1,
            created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at   TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS patients (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL,
            age             INTEGER,
            phone           TEXT,
            reason          TEXT,
            language        TEXT DEFAULT 'en',
            descriptor      TEXT NOT NULL,     -- JSON [128 floats] face embedding
            image_path      TEXT,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
            last_visit_at   TEXT DEFAULT CURRENT_TIMESTAMP,
            visit_count     INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS patient_visits (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id  INTEGER NOT NULL,
            kiosk_id    TEXT,
            session_id  TEXT,
            language    TEXT,
            recognised  INTEGER DEFAULT 1,
            distance    REAL,
            visited_at  TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        );
        """
    )


def _seed(conn: sqlite3.Connection) -> None:
    cur = conn.execute("SELECT COUNT(*) AS n FROM departments")
    if cur.fetchone()["n"] > 0:
        return  # already seeded

    for d in DEPARTMENTS:
        conn.execute(
            "INSERT INTO departments (id, map_id, floor, name, directions, aliases) VALUES (?, ?, ?, ?, ?, ?)",
            (d["id"], d["map_id"], d["floor"],
             json.dumps(d["name"], ensure_ascii=False),
             json.dumps(d["directions"], ensure_ascii=False),
             json.dumps(d["aliases"], ensure_ascii=False)),
        )

    for doc in DOCTORS:
        conn.execute(
            "INSERT INTO doctors (id, name, specialty, specialty_keys, room, slots_today) VALUES (?, ?, ?, ?, ?, ?)",
            (doc["id"],
             json.dumps(doc["name"], ensure_ascii=False),
             json.dumps(doc["specialty"], ensure_ascii=False),
             json.dumps(doc["specialty_keys"], ensure_ascii=False),
             doc["room"],
             json.dumps(doc["slots_today"], ensure_ascii=False)),
        )

    for faq in FAQS:
        cur = conn.execute(
            "INSERT INTO faqs (q, a, tags) VALUES (?, ?, ?)",
            (json.dumps(faq["q"], ensure_ascii=False),
             json.dumps(faq["a"], ensure_ascii=False),
             faq["tags"]),
        )
        faq_id = cur.lastrowid
        content = " ".join(list(faq["q"].values()) + list(faq["a"].values()) + [faq["tags"]])
        conn.execute(
            "INSERT INTO faqs_fts (content, faq_id) VALUES (?, ?)",
            (content, faq_id),
        )

    conn.commit()


def init_db() -> None:
    with _connect() as conn:
        _init_schema(conn)
        _seed(conn)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def all_departments() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM departments").fetchall()
    return [_row_to_dept(r) for r in rows]


def get_department(dept_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
    return _row_to_dept(row) if row else None


def all_doctors() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT * FROM doctors").fetchall()
    return [_row_to_doctor(r) for r in rows]


def get_doctor(doctor_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM doctors WHERE id = ?", (doctor_id,)).fetchone()
    return _row_to_doctor(row) if row else None


def search_faqs(query: str, limit: int = 3) -> list[dict[str, Any]]:
    if not query.strip():
        return []
    tokens = [t for t in query.replace('"', " ").split() if t]
    if not tokens:
        return []
    fts_q = " OR ".join(f'"{t}"' for t in tokens)
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT faqs.id, faqs.q, faqs.a, faqs.tags
              FROM faqs_fts
              JOIN faqs ON faqs.id = faqs_fts.faq_id
             WHERE faqs_fts MATCH ?
             ORDER BY rank
             LIMIT ?
            """,
            (fts_q, limit),
        ).fetchall()
    return [
        {"id": r["id"], "q": json.loads(r["q"]), "a": json.loads(r["a"]), "tags": r["tags"]}
        for r in rows
    ]


def log_staff_alert(kiosk_id: str | None, intent: str, language: str, payload: dict | None) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO staff_alerts (kiosk_id, intent, language, payload) VALUES (?, ?, ?, ?)",
            (kiosk_id, intent, language, json.dumps(payload or {}, ensure_ascii=False)),
        )
        conn.commit()
        return cur.lastrowid


# ---------------------------------------------------------------------------
# Conversation history (orchestrator)
# ---------------------------------------------------------------------------

def add_conversation_message(
    kiosk_id: str | None,
    session_id: str | None,
    role: str,
    content: str,
    language: str,
) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO conversations (kiosk_id, session_id, role, content, language) VALUES (?, ?, ?, ?, ?)",
            (kiosk_id, session_id, role, content, language),
        )
        conn.commit()


def recent_conversation(
    kiosk_id: str | None,
    session_id: str | None,
    limit: int = 6,
) -> list[dict[str, str]]:
    """Return the last `limit` messages (oldest first) for context injection."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT role, content FROM conversations
             WHERE kiosk_id IS ? AND session_id IS ?
             ORDER BY id DESC
             LIMIT ?
            """,
            (kiosk_id, session_id, limit),
        ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


# ---------------------------------------------------------------------------
# Response cache (orchestrator)
# ---------------------------------------------------------------------------

def make_cache_key(language: str, text: str) -> str:
    norm = " ".join((text or "").lower().split())
    return hashlib.sha256(f"{language}|{norm}".encode("utf-8")).hexdigest()


def get_cached_response(cache_key: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM response_cache WHERE cache_key = ?", (cache_key,)
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE response_cache SET hit_count = hit_count + 1, updated_at = CURRENT_TIMESTAMP WHERE cache_key = ?",
            (cache_key,),
        )
        conn.commit()
    return {
        "reply": row["reply"],
        "intent": row["intent"],
        "options": json.loads(row["options"] or "[]"),
        "map_target": row["map_target"],
        "alert": bool(row["alert"]),
        "data": json.loads(row["data"]) if row["data"] else None,
    }


def cache_response(cache_key: str, response: dict[str, Any]) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO response_cache
                (cache_key, reply, intent, options, map_target, alert, data, hit_count, updated_at)
            VALUES (
                ?, ?, ?, ?, ?, ?, ?,
                COALESCE((SELECT hit_count FROM response_cache WHERE cache_key = ?), 1),
                CURRENT_TIMESTAMP
            )
            """,
            (
                cache_key,
                response.get("reply", ""),
                response.get("intent"),
                json.dumps(response.get("options") or [], ensure_ascii=False),
                response.get("map_target"),
                1 if response.get("alert") else 0,
                json.dumps(response.get("data")) if response.get("data") is not None else None,
                cache_key,
            ),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# Patients (face registration + recognition)
# ---------------------------------------------------------------------------

def register_patient(
    name: str,
    age: int | None,
    phone: str | None,
    reason: str | None,
    language: str,
    descriptor: list[float],
    image_path: str | None,
) -> int:
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO patients (name, age, phone, reason, language, descriptor, image_path)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (name, age, phone, reason, language,
             json.dumps(descriptor), image_path),
        )
        conn.commit()
        return cur.lastrowid


def all_patients() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, age, phone, reason, language, image_path, "
            "created_at, last_visit_at, visit_count FROM patients ORDER BY id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_patient(patient_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if not row:
        return None
    out = dict(row)
    out["descriptor"] = json.loads(out["descriptor"])
    return out


def get_all_descriptors() -> list[tuple[int, str, list[float]]]:
    """Return [(id, name, descriptor)] for matching."""
    with _connect() as conn:
        rows = conn.execute("SELECT id, name, descriptor FROM patients").fetchall()
    return [(r["id"], r["name"], json.loads(r["descriptor"])) for r in rows]


def log_patient_visit(
    patient_id: int,
    kiosk_id: str | None,
    session_id: str | None,
    language: str,
    distance: float,
) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO patient_visits (patient_id, kiosk_id, session_id, language, distance) "
            "VALUES (?, ?, ?, ?, ?)",
            (patient_id, kiosk_id, session_id, language, distance),
        )
        conn.execute(
            "UPDATE patients SET last_visit_at = CURRENT_TIMESTAMP, visit_count = visit_count + 1 "
            "WHERE id = ?",
            (patient_id,),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# Row -> dict conversion
# ---------------------------------------------------------------------------

def _row_to_dept(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"],
        "map_id": r["map_id"],
        "floor": r["floor"],
        "name": json.loads(r["name"]),
        "directions": json.loads(r["directions"]),
        "aliases": json.loads(r["aliases"]),
    }


def _row_to_doctor(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"],
        "name": json.loads(r["name"]),
        "specialty": json.loads(r["specialty"]),
        "specialty_keys": json.loads(r["specialty_keys"]),
        "room": r["room"],
        "slots_today": json.loads(r["slots_today"]),
    }
