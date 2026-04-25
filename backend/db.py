"""SQLite-backed knowledge store for the kiosk.

Uses FTS5 for vectorless RAG keyword search over a multilingual FAQ table.
On first import the schema is created and seeded from `seed_data.py`.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from seed_data import DEPARTMENTS, DOCTORS, FAQS

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

        -- FTS5 virtual table for keyword retrieval (vectorless RAG)
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
        # Index every language variant so FTS works regardless of query language.
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
# Read helpers (used by the rule-based router and the GPT-4o tools)
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
    """Vectorless RAG: FTS5 keyword search across multilingual content."""
    if not query.strip():
        return []
    # Sanitize for FTS5 — tokens only, OR them together for fuzzy matching.
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
        {
            "id": r["id"],
            "q": json.loads(r["q"]),
            "a": json.loads(r["a"]),
            "tags": r["tags"],
        }
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
