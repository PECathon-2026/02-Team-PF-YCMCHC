"""
Unit tests for normalize_feed_url_syntactic — FEATURE 9

Tests 20+ URL variant pairs that MUST collapse to one canonical form,
and 5+ pairs that MUST NOT collapse (different blogs on same host / different schemes).
"""

import unittest
from server.discovery import normalize_feed_url_syntactic


class TestUrlNormalizationCollapse(unittest.TestCase):
    """URL pairs that MUST normalize to the same canonical string."""

    def assertNormalizeEqual(self, url_a, url_b, msg=None):
        """Assert that two URLs normalize to the same value."""
        na = normalize_feed_url_syntactic(url_a)
        nb = normalize_feed_url_syntactic(url_b)
        self.assertEqual(na, nb, msg or f"{url_a!r} and {url_b!r} should normalize to the same URL, got {na!r} vs {nb!r}")

    # --- 1. Hostname lowercase ---
    def test_hostname_lowercase(self):
        self.assertNormalizeEqual(
            "http://EXAMPLE.com/feed",
            "http://example.com/feed"
        )

    # --- 2. Full hostname + scheme uppercase ---
    def test_scheme_and_hostname_uppercase(self):
        self.assertNormalizeEqual(
            "HTTPS://WWW.EXAMPLE.COM/feed",
            "https://example.com/feed"
        )

    # --- 3. www. prefix stripped ---
    def test_www_prefix_stripped(self):
        self.assertNormalizeEqual(
            "https://www.example.com/feed",
            "https://example.com/feed"
        )

    # --- 4. utm_source tracking param removed ---
    def test_utm_source_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?utm_source=newsletter",
            "https://example.com/feed"
        )

    # --- 5. utm_medium tracking param removed ---
    def test_utm_medium_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?utm_medium=rss",
            "https://example.com/feed"
        )

    # --- 6. utm_campaign tracking param removed ---
    def test_utm_campaign_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?utm_campaign=weekly",
            "https://example.com/feed"
        )

    # --- 7. utm_term tracking param removed ---
    def test_utm_term_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?utm_term=rss",
            "https://example.com/feed"
        )

    # --- 8. utm_content tracking param removed ---
    def test_utm_content_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?utm_content=link",
            "https://example.com/feed"
        )

    # --- 9. fbclid tracking param removed ---
    def test_fbclid_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?fbclid=abc123",
            "https://example.com/feed"
        )

    # --- 10. gclid tracking param removed ---
    def test_gclid_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?gclid=xyz",
            "https://example.com/feed"
        )

    # --- 11. ref tracking param removed ---
    def test_ref_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?ref=sidebar",
            "https://example.com/feed"
        )

    # --- 12. mc_eid tracking param removed ---
    def test_mc_eid_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?mc_eid=abc",
            "https://example.com/feed"
        )

    # --- 13. source tracking param removed (new in expanded list) ---
    def test_source_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?source=feed",
            "https://example.com/feed"
        )

    # --- 14. via tracking param removed (new in expanded list) ---
    def test_via_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?via=twitter",
            "https://example.com/feed"
        )

    # --- 15. ck_subscriber_id tracking param removed (new in expanded list) ---
    def test_ck_subscriber_id_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/blog/feed?ck_subscriber_id=123",
            "https://example.com/blog/feed"
        )

    # --- 16. Multiple tracking params removed together ---
    def test_multiple_tracking_params_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?utm_medium=rss&utm_source=blog",
            "https://example.com/feed"
        )

    # --- 17. Mixed tracking + real param: only tracking removed ---
    def test_tracking_removed_real_param_kept(self):
        na = normalize_feed_url_syntactic("https://example.com/feed?ref=reader&actual_param=keep")
        nb = normalize_feed_url_syntactic("https://example.com/feed?actual_param=keep")
        self.assertEqual(na, nb)

    # --- 18. Default HTTPS port 443 removed ---
    def test_default_https_port_removed(self):
        self.assertNormalizeEqual(
            "https://example.com:443/feed",
            "https://example.com/feed"
        )

    # --- 19. Default HTTP port 80 removed ---
    def test_default_http_port_removed(self):
        self.assertNormalizeEqual(
            "http://example.com:80/feed",
            "http://example.com/feed"
        )

    # --- 20. Fragment removed ---
    def test_fragment_removed(self):
        self.assertNormalizeEqual(
            "http://www.example.com/atom.xml#section1",
            "http://example.com/atom.xml"
        )

    # --- 21. Real-world: simonwillison.net with www + uppercase ---
    def test_simonwillison_www_uppercase(self):
        self.assertNormalizeEqual(
            "https://WWW.simonwillison.net/atom/everything/",
            "https://simonwillison.net/atom/everything/"
        )

    # --- 22. Real-world: danluu.com with www + tracking ---
    def test_danluu_www_tracking(self):
        self.assertNormalizeEqual(
            "http://www.danluu.com/atom.xml?utm_campaign=rss",
            "http://danluu.com/atom.xml"
        )

    # --- 23. Path casing preserved (only hostname lowercased) ---
    def test_path_casing_preserved(self):
        na = normalize_feed_url_syntactic("https://EXAMPLE.COM/path/to/Feed.xml")
        self.assertEqual(na, "https://example.com/path/to/Feed.xml")

    # --- 24. www + default port + tracking all removed together ---
    def test_www_default_port_tracking_combined(self):
        self.assertNormalizeEqual(
            "https://example.com:443/feed?source=newsletter",
            "https://example.com/feed"
        )

    # --- 25. gclid and mc_eid both removed ---
    def test_gclid_and_mc_eid_both_removed(self):
        self.assertNormalizeEqual(
            "https://example.com/feed?gclid=xxx&mc_eid=yyy",
            "https://example.com/feed"
        )

    # --- 26. Trailing slash preserved on non-root paths (not stripped) ---
    def test_trailing_slash_preserved_non_root(self):
        na = normalize_feed_url_syntactic("http://www.example.com/feed/")
        self.assertEqual(na, "http://example.com/feed/")

    # --- 27. utm_source + keep=1: only tracking removed, keep survives ---
    def test_utm_source_removed_keep_survives(self):
        na = normalize_feed_url_syntactic("https://www.example.com/feed?utm_source=x&keep=1")
        self.assertEqual(na, "https://example.com/feed?keep=1")

    # --- 28. utm_content + custom=val: only tracking removed ---
    def test_utm_content_removed_custom_survives(self):
        na = normalize_feed_url_syntactic("https://example.com/feed?utm_content=link&custom=val")
        self.assertEqual(na, "https://example.com/feed?custom=val")

    # --- 29. www + via + uppercase combined ---
    def test_www_via_uppercase_combined(self):
        self.assertNormalizeEqual(
            "http://WWW.EXAMPLE.COM/rss.xml?via=feedly",
            "http://example.com/rss.xml"
        )

    # --- 30. HTTPS uppercase example.com path case preserved ---
    def test_uppercase_hostname_path_preserved(self):
        na = normalize_feed_url_syntactic("https://EXAMPLE.com/FEED")
        self.assertEqual(na, "https://example.com/FEED")


class TestUrlNormalizationNoCollapse(unittest.TestCase):
    """URL pairs that MUST NOT normalize to the same canonical string (stay distinct)."""

    def assertNormalizeNotEqual(self, url_a, url_b, msg=None):
        """Assert that two URLs do NOT normalize to the same value."""
        na = normalize_feed_url_syntactic(url_a)
        nb = normalize_feed_url_syntactic(url_b)
        self.assertNotEqual(na, nb, msg or f"{url_a!r} and {url_b!r} should NOT normalize to the same URL, but both gave {na!r}")

    # --- 1. Different paths on same host ---
    def test_different_user_feeds(self):
        self.assertNormalizeNotEqual(
            "https://example.com/user1/feed",
            "https://example.com/user2/feed"
        )

    # --- 2. Different blog paths on same host ---
    def test_different_blog_paths(self):
        self.assertNormalizeNotEqual(
            "https://example.com/blog1/rss.xml",
            "https://example.com/blog2/rss.xml"
        )

    # --- 3. Different schemes are NOT collapsed ---
    def test_different_schemes_not_collapsed(self):
        self.assertNormalizeNotEqual(
            "https://example.com/feed",
            "http://example.com/feed"
        )

    # --- 4. Different feed filenames on same host ---
    def test_different_feed_filenames(self):
        self.assertNormalizeNotEqual(
            "https://example.com/rss.xml",
            "https://example.com/atom.xml"
        )

    # --- 5. Different language-prefix paths ---
    def test_different_language_paths(self):
        self.assertNormalizeNotEqual(
            "https://example.com/en/feed",
            "https://example.com/fr/feed"
        )

    # --- 6. Non-default port is preserved (not collapsed to standard) ---
    def test_non_default_port_preserved(self):
        self.assertNormalizeNotEqual(
            "https://example.com:8443/feed",
            "https://example.com/feed"
        )


class TestUrlNormalizationSpecific(unittest.TestCase):
    """Specific expected output values for normalization."""

    def test_existing_test_preserved(self):
        """Existing test in test_discovery.py must still pass."""
        raw = "HTTPS://Example.COM:443/Feed/Path?utm_source=twitter&keep=1#fragment"
        norm = normalize_feed_url_syntactic(raw)
        # Original test expected "https://example.com/Feed/Path?keep=1"
        # With www-stripping: example.com has no www, so same result
        self.assertEqual(norm, "https://example.com/Feed/Path?keep=1")

    def test_www_stripped_from_hostname(self):
        norm = normalize_feed_url_syntactic("https://www.simonwillison.net/atom/everything/")
        self.assertEqual(norm, "https://simonwillison.net/atom/everything/")

    def test_expanded_tracking_source(self):
        norm = normalize_feed_url_syntactic("https://example.com/feed?source=rss")
        self.assertEqual(norm, "https://example.com/feed")

    def test_expanded_tracking_via(self):
        norm = normalize_feed_url_syntactic("https://example.com/feed?via=feedly")
        self.assertEqual(norm, "https://example.com/feed")

    def test_expanded_tracking_ck_subscriber_id(self):
        norm = normalize_feed_url_syntactic("https://example.com/feed?ck_subscriber_id=99999")
        self.assertEqual(norm, "https://example.com/feed")

    def test_root_path_preserved(self):
        """Root path '/' is preserved as-is."""
        norm = normalize_feed_url_syntactic("https://www.example.com/?utm_source=x")
        self.assertEqual(norm, "https://example.com/")

    def test_empty_query_after_stripping(self):
        norm = normalize_feed_url_syntactic("https://example.com/feed?fbclid=abc&gclid=xyz")
        self.assertEqual(norm, "https://example.com/feed")

    def test_non_default_port_kept(self):
        norm = normalize_feed_url_syntactic("http://example.com:8080/feed")
        self.assertEqual(norm, "http://example.com:8080/feed")


if __name__ == "__main__":
    unittest.main()
