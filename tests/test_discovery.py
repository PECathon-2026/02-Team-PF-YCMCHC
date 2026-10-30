"""
Unit tests for Anonymous Discovery & Recommendation Engine in Commonplace (PS-003)
"""

import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from server.discovery import (
    record_anonymous_batch,
    compute_recommendations,
    normalize_feed_url_syntactic,
    init_db
)
from server.seed_data import ensure_seeded_idempotent, audit_organizer_seed


class TestAnonymousDiscovery(unittest.TestCase):

    def setUp(self):
        # Create an isolated temporary SQLite database for each test
        self.temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.temp_db.close()
        self.db_patcher = patch("server.discovery.DB_PATH", self.temp_db.name)
        self.db_patcher.start()
        init_db()

    def tearDown(self):
        self.db_patcher.stop()
        if os.path.exists(self.temp_db.name):
            try:
                os.remove(self.temp_db.name)
            except Exception:
                pass

    def test_syntactic_normalization(self):
        """Syntactic normalization must lowercase scheme/host, preserve path casing, and drop tracking params."""
        raw = "HTTPS://Example.COM:443/Feed/Path?utm_source=twitter&keep=1#fragment"
        norm = normalize_feed_url_syntactic(raw)
        self.assertEqual(norm, "https://example.com/Feed/Path?keep=1")

    def test_batch_deduplication_within_batch(self):
        """Duplicate URLs inside a single batch must count as only 1 batch increment."""
        batch_with_dupes = [
            "https://blog.example.com/feed.xml",
            "https://blog.example.com/feed.xml",  # duplicate
            "https://another.example.org/rss",
        ]
        result = record_anonymous_batch(batch_with_dupes)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["accepted_feeds_count"], 2)

        # In DB, accepted_batch_count must be exactly 1
        with sqlite3.connect(self.temp_db.name) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT accepted_batch_count FROM feed_stats WHERE feed_url = 'https://blog.example.com/feed.xml'"
            ).fetchone()
            self.assertEqual(row["accepted_batch_count"], 1)

    def test_bounded_co_subscription_increment(self):
        """Each unique pair in a batch must increment by at most 1, even in large batches."""
        batch = [
            "https://feed1.com/rss",
            "https://feed2.com/rss",
            "https://feed3.com/rss"
        ]
        record_anonymous_batch(batch)

        with sqlite3.connect(self.temp_db.name) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT pair_count FROM co_subscriptions").fetchall()
            for r in rows:
                self.assertEqual(r["pair_count"], 1)

    def test_exclusion_of_user_subscriptions_and_aliases(self):
        """Recommendations must strictly exclude user's current subscriptions and verified aliases."""
        feed_a = "https://user-sub.com/rss"
        feed_b = "https://candidate.com/rss"
        feed_alias = "https://candidate-alias.com/rss"

        # Batch 1
        record_anonymous_batch([feed_a, feed_b, feed_alias])
        # Batch 2 to satisfy minimum support threshold
        record_anonymous_batch([feed_a, feed_b, feed_alias])

        # Register alias in DB
        with sqlite3.connect(self.temp_db.name) as conn:
            conn.execute(
                "INSERT INTO aliases (source_url, target_url, evidence_type, evidence_details, created_at) VALUES (?, ?, ?, ?, ?)",
                (feed_b, feed_alias, "REDIRECT", "301 moved", 1000)
            )
            conn.commit()

        # If user subscribes to feed_a, they can get feed_b, but if they subscribe to feed_b, neither feed_b nor feed_alias should appear
        recs = compute_recommendations(user_feed_urls=[feed_b], mode="related")
        recommended_urls = [r["feed_url"] for r in recs]
        self.assertNotIn(feed_b, recommended_urls)
        self.assertNotIn(feed_alias, recommended_urls)

    def test_deterministic_tie_breaking(self):
        """Feeds with identical scores must be sorted alphabetically by feed URL."""
        # 2 independent feeds with same count
        record_anonymous_batch(["https://z-feed.com/rss"])
        record_anonymous_batch(["https://z-feed.com/rss"])
        record_anonymous_batch(["https://a-feed.com/rss"])
        record_anonymous_batch(["https://a-feed.com/rss"])

        recs = compute_recommendations(user_feed_urls=[], mode="popular")
        urls = [r["feed_url"] for r in recs]
        self.assertEqual(urls, ["https://a-feed.com/rss", "https://z-feed.com/rss"])

    def test_synthetic_data_labeled(self):
        """Synthetic batches must have is_synthetic = True and be marked as demo data."""
        batch = ["https://synth1.com/rss", "https://synth2.com/rss"]
        record_anonymous_batch(batch, is_synthetic=True)
        record_anonymous_batch(batch, is_synthetic=True)

        recs = compute_recommendations(user_feed_urls=[], mode="popular")
        for r in recs:
            self.assertTrue(r["is_synthetic"])

    def test_organizer_seed_audit_blocked_when_missing(self):
        """If organizer seed list is missing, status must report BLOCKED rather than invent an audit."""
        status = audit_organizer_seed()
        self.assertEqual(status["status"], "BLOCKED")
        self.assertIn("Missing input", status["reason"])


if __name__ == "__main__":
    unittest.main()
