"""
Seed Data & Demo Integrity Manager for Commonplace (PS-003)
Handles organizer seed list audits, idempotent initialization, and synthetic data tagging.
"""

import os
import sys
import json
from typing import Dict, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from server.discovery import get_db_connection, record_anonymous_batch, init_db

ORGANIZER_SEED_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seed_feeds.json")

# Documented curated synthetic demo dataset for offline demonstration
# All items have is_synthetic = True
SYNTHETIC_DEMO_BATCHES = [
    {
        "urls": [
            "https://simonwillison.net/atom/everything/",
            "https://danluu.com/atom.xml",
            "https://fasterthanli.me/index.xml"
        ],
        "titles": {
            "https://simonwillison.net/atom/everything/": "Simon Willison’s Weblog",
            "https://danluu.com/atom.xml": "Dan Luu",
            "https://fasterthanli.me/index.xml": "fasterthanli.me"
        }
    },
    {
        "urls": [
            "https://simonwillison.net/atom/everything/",
            "https://xeiaso.net/blog.rss",
            "https://krebsonsecurity.com/feed/"
        ],
        "titles": {
            "https://simonwillison.net/atom/everything/": "Simon Willison’s Weblog",
            "https://xeiaso.net/blog.rss": "Xe Iaso's Blog",
            "https://krebsonsecurity.com/feed/": "Krebs on Security"
        }
    },
    {
        "urls": [
            "https://danluu.com/atom.xml",
            "https://fasterthanli.me/index.xml",
            "https://xeiaso.net/blog.rss"
        ],
        "titles": {
            "https://danluu.com/atom.xml": "Dan Luu",
            "https://fasterthanli.me/index.xml": "fasterthanli.me",
            "https://xeiaso.net/blog.rss": "Xe Iaso's Blog"
        }
    },
    {
        "urls": [
            "https://pluralistic.net/feed/",
            "https://krebsonsecurity.com/feed/",
            "https://arstechnica.com/feed/"
        ],
        "titles": {
            "https://pluralistic.net/feed/": "Pluralistic: Daily links by Cory Doctorow",
            "https://krebsonsecurity.com/feed/": "Krebs on Security",
            "https://arstechnica.com/feed/": "Ars Technica"
        }
    },
    {
        "urls": [
            "https://arstechnica.com/feed/",
            "https://simonwillison.net/atom/everything/"
        ],
        "titles": {
            "https://arstechnica.com/feed/": "Ars Technica",
            "https://simonwillison.net/atom/everything/": "Simon Willison’s Weblog"
        }
    }
]


def audit_organizer_seed() -> Dict[str, Any]:
    """
    Checks for the organizer-supplied seed file.
    If missing, returns a BLOCKED audit status to maintain data integrity.
    """
    if not os.path.exists(ORGANIZER_SEED_PATH):
        return {
            "status": "BLOCKED",
            "reason": (
                "Missing input: The official organizer-supplied seed list was not provided in the workspace. "
                "Per section 10, the audit is marked BLOCKED rather than substituting an unverified list."
            ),
            "file_path": ORGANIZER_SEED_PATH
        }

    try:
        with open(ORGANIZER_SEED_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "status": "AUDITED",
            "total_urls": len(data.get("feeds", [])),
            "raw_feeds": data.get("feeds", [])
        }
    except Exception as e:
        return {
            "status": "AUDIT_FAILED",
            "error": str(e)
        }


def ensure_seeded_idempotent() -> Dict[str, Any]:
    """
    Initializes discovery demo data if not already done.
    Ensures idempotency by checking `synthetic_seed_initialized` in `system_meta`.
    """
    init_db()
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM system_meta WHERE key = 'synthetic_seed_initialized'")
        row = cursor.fetchone()
        if row and row["value"] == "1":
            return {"status": "already_seeded", "idempotent": True}
    finally:
        conn.close()

    # Record synthetic batches
    for batch in SYNTHETIC_DEMO_BATCHES:
        record_anonymous_batch(
            feed_urls=batch["urls"],
            titles=batch["titles"],
            is_synthetic=True
        )

    conn2 = get_db_connection()
    try:
        cursor2 = conn2.cursor()
        cursor2.execute("INSERT OR REPLACE INTO system_meta (key, value) VALUES ('synthetic_seed_initialized', '1')")
        conn2.commit()
    finally:
        conn2.close()

    return {"status": "seeded", "synthetic_batches_loaded": len(SYNTHETIC_DEMO_BATCHES)}
