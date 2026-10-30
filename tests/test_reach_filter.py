"""
Tests for Feature 6: Minimum-reach filter for recommendations (PS-003)
Verifies:
  - Feeds below MIN_REACH_BATCHES are excluded from recommendations
  - Seeded (is_synthetic=1) feeds are exempt from the reach filter
  - Feeds with last_activity_timestamp older than MIN_RECENT_DAYS are excluded
  - Feeds with batch_count < PRIVACY_UNIQUE_THRESHOLD are excluded (privacy protection)
"""

import os
import sqlite3
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class TestReachFilter(unittest.TestCase):

    def setUp(self):
        # Use a temp file for isolated test DB
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()

        import server.discovery as disc
        self._orig_db_path = disc.DB_PATH
        disc.DB_PATH = self.tmp.name
        disc.init_db()
        self.disc = disc

    def tearDown(self):
        self.disc.DB_PATH = self._orig_db_path
        try:
            os.unlink(self.tmp.name)
        except Exception:
            pass

    def _insert_feed_directly(self, feed_url, title, accepted_batch_count, is_synthetic=0,
                               last_activity_timestamp=None):
        """Helper: Insert a feed_stats row directly via SQL for precise control."""
        now_ms = int(time.time() * 1000)
        if last_activity_timestamp is None:
            last_activity_timestamp = now_ms
        with sqlite3.connect(self.tmp.name) as conn:
            conn.execute("""
                INSERT OR REPLACE INTO feed_stats
                    (feed_url, title, site_url, accepted_batch_count, is_synthetic,
                     first_seen_timestamp, last_seen_timestamp, last_activity_timestamp, category)
                VALUES (?, ?, '', ?, ?, ?, ?, ?, '')
            """, (feed_url, title, accepted_batch_count, is_synthetic,
                  now_ms, now_ms, last_activity_timestamp))
            conn.commit()

    def test_below_reach_excluded(self):
        """A feed with batch_count=1 (below MIN_REACH_BATCHES=2) should NOT appear in recommendations."""
        low_reach_url = "https://low-reach.example.com/rss"
        # Insert one feed below threshold (batch_count=1) and one above (batch_count=2)
        self._insert_feed_directly(low_reach_url, "Low Reach Feed", accepted_batch_count=1)
        self._insert_feed_directly("https://high-reach.example.com/rss", "High Reach Feed", accepted_batch_count=2)

        recs = self.disc.compute_recommendations(user_feed_urls=[], mode="popular")
        recommended_urls = [r["feed_url"] for r in recs]

        self.assertNotIn(low_reach_url, recommended_urls,
                         "Feed below MIN_REACH_BATCHES must be excluded from recommendations")
        self.assertIn("https://high-reach.example.com/rss", recommended_urls,
                      "Feed meeting MIN_REACH_BATCHES should appear in recommendations")

    def test_seed_exempt_from_reach_filter(self):
        """A seeded (is_synthetic=1) feed with batch_count=1 should still appear in recommendations."""
        seed_url = "https://seed-feed.example.com/rss"
        self._insert_feed_directly(seed_url, "Seed Feed", accepted_batch_count=1, is_synthetic=1)

        recs = self.disc.compute_recommendations(user_feed_urls=[], mode="popular")
        recommended_urls = [r["feed_url"] for r in recs]

        self.assertIn(seed_url, recommended_urls,
                      "Seeded feed (is_synthetic=1) must be exempt from the MIN_REACH_BATCHES filter")

    def test_stale_feed_excluded(self):
        """A feed with batch_count=5 but last_activity_timestamp older than MIN_RECENT_DAYS is excluded."""
        stale_url = "https://stale-feed.example.com/rss"
        fresh_url = "https://fresh-feed.example.com/rss"

        # Calculate a timestamp that is clearly beyond MIN_RECENT_DAYS (default 90) in the past
        min_recent_days = self.disc.MIN_RECENT_DAYS
        old_ts = int(time.time() * 1000) - ((min_recent_days + 10) * 86400 * 1000)

        self._insert_feed_directly(stale_url, "Stale Feed", accepted_batch_count=5,
                                   last_activity_timestamp=old_ts)
        self._insert_feed_directly(fresh_url, "Fresh Feed", accepted_batch_count=5)

        recs = self.disc.compute_recommendations(user_feed_urls=[], mode="popular")
        recommended_urls = [r["feed_url"] for r in recs]

        self.assertNotIn(stale_url, recommended_urls,
                         "Stale feed (last_activity beyond MIN_RECENT_DAYS) must be excluded")
        self.assertIn(fresh_url, recommended_urls,
                      "Fresh feed should still appear in recommendations")

    def test_privacy_threshold_respected(self):
        """A non-seed feed with batch_count < PRIVACY_UNIQUE_THRESHOLD should be excluded for privacy protection."""
        privacy_url = "https://rare-feed.example.com/rss"
        privacy_threshold = self.disc.PRIVACY_UNIQUE_THRESHOLD  # default 2

        # Insert a feed with batch_count below privacy threshold (but >=1 and is_synthetic=0)
        self._insert_feed_directly(privacy_url, "Rare Feed",
                                   accepted_batch_count=privacy_threshold - 1,
                                   is_synthetic=0)

        recs = self.disc.compute_recommendations(user_feed_urls=[], mode="popular")
        recommended_urls = [r["feed_url"] for r in recs]

        self.assertNotIn(privacy_url, recommended_urls,
                         "Feed with batch_count below PRIVACY_UNIQUE_THRESHOLD must be excluded to protect privacy")

    def test_system_stats_includes_thresholds(self):
        """get_system_stats() should include min_reach_batches, min_recent_days, privacy_unique_threshold."""
        stats = self.disc.get_system_stats()
        self.assertIn("min_reach_batches", stats)
        self.assertIn("min_recent_days", stats)
        self.assertIn("privacy_unique_threshold", stats)
        self.assertEqual(stats["min_reach_batches"], self.disc.MIN_REACH_BATCHES)
        self.assertEqual(stats["min_recent_days"], self.disc.MIN_RECENT_DAYS)
        self.assertEqual(stats["privacy_unique_threshold"], self.disc.PRIVACY_UNIQUE_THRESHOLD)


if __name__ == "__main__":
    unittest.main()
