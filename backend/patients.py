"""Patient face-registration & recognition helpers.

Face descriptors are 128-D float vectors generated client-side via
face-api.js. The backend simply stores them and computes Euclidean
distance for matching — no server-side ML dependencies required.

Distance interpretation (face-api.js):
- < 0.45  → very likely same person
- 0.45–0.6 → possibly same person (use as match threshold)
- > 0.6  → different person

The default match threshold (0.55) is conservative; tune via
PATIENT_MATCH_THRESHOLD env var if needed.
"""

from __future__ import annotations

import logging
import math
import os
import uuid
from pathlib import Path
from typing import Any

import db

log = logging.getLogger("hospital-kiosk.patients")

UPLOADS_DIR = Path(__file__).parent / "uploads" / "patients"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

MATCH_THRESHOLD = float(os.environ.get("PATIENT_MATCH_THRESHOLD", "0.55"))


def _euclidean(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return float("inf")
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def find_match(
    descriptor: list[float],
    threshold: float | None = None,
) -> dict[str, Any] | None:
    """Return the closest patient if distance < threshold, else None."""
    if not descriptor or len(descriptor) != 128:
        return None
    thresh = threshold if threshold is not None else MATCH_THRESHOLD
    best_id: int | None = None
    best_name: str | None = None
    best_dist = float("inf")
    for pid, name, desc in db.get_all_descriptors():
        d = _euclidean(descriptor, desc)
        if d < best_dist:
            best_dist = d
            best_id = pid
            best_name = name
    if best_id is not None and best_dist < thresh:
        return {"id": best_id, "name": best_name, "distance": round(best_dist, 4)}
    log.info("no patient match (best=%s, dist=%.3f, threshold=%.2f)",
             best_name, best_dist, thresh)
    return None


def save_image(image_bytes: bytes, ext: str = "jpg") -> str:
    """Persist image to uploads/ and return relative path stored in DB."""
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = UPLOADS_DIR / fname
    fpath.write_bytes(image_bytes)
    # Store as a relative POSIX-style path so it's portable.
    return f"uploads/patients/{fname}"


def absolute_image_path(rel_path: str) -> Path | None:
    if not rel_path:
        return None
    p = Path(__file__).parent / rel_path
    return p if p.exists() else None
