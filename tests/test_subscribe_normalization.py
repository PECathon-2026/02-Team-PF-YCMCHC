"""
Unit tests for subscribe idempotency via URL normalization (FEATURE 1).

Tests the server-side normalize_feed_url_syntactic function as a proxy for
client-side normalizeUrlClient idempotency behavior. The key property is:
subscribing to the same URL in multiple different textual forms should
yield the same normalized key, enabling duplicate detection.
"""

import unittest
from server.discovery import normalize_feed_url_syntactic


class TestSubscribeNormalizationIdempotency(unittest.TestCase):
    """
    Tests that URL normalization is idempotent (applying it twice yields same result)
    and that semantically equivalent URLs produce identical normalized forms.
    This mirrors the duplicate-detection logic in subscribeToUrl().
    """

    def assertIdempotent(self, url):
        """Normalizing twice yields same result as normalizing once."""
        once = normalize_feed_url_syntactic(url)
        twice = normalize_feed_url_syntactic(once)
        self.assertEqual(once, twice, f"Normalization of {url!r} is not idempotent: {once!r} -> {twice!r}")

    def assertSameSubscription(self, url_a, url_b):
        """Two URL forms that should resolve to the same subscription key."""
        na = normalize_feed_url_syntactic(url_a)
        nb = normalize_feed_url_syntactic(url_b)
        self.assertEqual(na, nb, f"Expected same subscription key for:\n  {url_a!r}\n  {url_b!r}\nGot:\n  {na!r}\n  {nb!r}")

    def assertDifferentSubscription(self, url_a, url_b):
        """Two URL forms that must remain separate subscriptions."""
        na = normalize_feed_url_syntactic(url_a)
        nb = normalize_feed_url_syntactic(url_b)
        self.assertNotEqual(na, nb, f"Expected different subscription keys for:\n  {url_a!r}\n  {url_b!r}")

    # --- Idempotency tests ---

    def test_idempotent_plain_url(self):
        self.assertIdempotent("https://example.com/feed")

    def test_idempotent_www_url(self):
        """After www stripping, re-normalizing must not strip again or change result."""
        self.assertIdempotent("https://www.simonwillison.net/atom/everything/")

    def test_idempotent_tracking_url(self):
        """After removing tracking params, re-normalizing must be stable."""
        self.assertIdempotent("https://example.com/feed?utm_source=twitter")

    def test_idempotent_uppercase_hostname(self):
        self.assertIdempotent("https://EXAMPLE.COM/feed")

    def test_idempotent_default_port(self):
        self.assertIdempotent("https://example.com:443/feed")

    def test_idempotent_mixed(self):
        self.assertIdempotent("HTTPS://WWW.EXAMPLE.COM:443/Feed?utm_source=x&keep=1#frag")

    # --- Same subscription (should deduplicate) ---

    def test_same_sub_www_vs_no_www(self):
        """www.example.com and example.com must map to same subscription."""
        self.assertSameSubscription(
            "https://www.example.com/feed",
            "https://example.com/feed"
        )

    def test_same_sub_uppercase_hostname(self):
        self.assertSameSubscription(
            "https://EXAMPLE.COM/feed",
            "https://example.com/feed"
        )

    def test_same_sub_utm_source(self):
        self.assertSameSubscription(
            "https://example.com/feed?utm_source=newsletter",
            "https://example.com/feed"
        )

    def test_same_sub_fbclid(self):
        self.assertSameSubscription(
            "https://example.com/feed?fbclid=abc123",
            "https://example.com/feed"
        )

    def test_same_sub_default_port_https(self):
        self.assertSameSubscription(
            "https://example.com:443/feed",
            "https://example.com/feed"
        )

    def test_same_sub_default_port_http(self):
        self.assertSameSubscription(
            "http://example.com:80/feed",
            "http://example.com/feed"
        )

    def test_same_sub_fragment(self):
        self.assertSameSubscription(
            "https://example.com/feed#section",
            "https://example.com/feed"
        )

    def test_same_sub_multiple_tracking(self):
        self.assertSameSubscription(
            "https://example.com/feed?utm_source=x&utm_medium=rss&fbclid=abc&via=feedly",
            "https://example.com/feed"
        )

    def test_same_sub_www_plus_tracking(self):
        self.assertSameSubscription(
            "https://www.example.com/feed?ref=rss",
            "https://example.com/feed"
        )

    def test_same_sub_simonwillison_www_variant(self):
        self.assertSameSubscription(
            "https://www.simonwillison.net/atom/everything/",
            "https://simonwillison.net/atom/everything/"
        )

    def test_same_sub_ck_subscriber_id(self):
        self.assertSameSubscription(
            "https://example.com/blog/feed?ck_subscriber_id=999",
            "https://example.com/blog/feed"
        )

    def test_same_sub_source_param(self):
        self.assertSameSubscription(
            "https://example.com/feed?source=rss",
            "https://example.com/feed"
        )

    # --- Different subscriptions (must NOT deduplicate) ---

    def test_different_sub_different_paths(self):
        """Two feeds from the same host but different paths are different subscriptions."""
        self.assertDifferentSubscription(
            "https://example.com/user1/feed",
            "https://example.com/user2/feed"
        )

    def test_different_sub_http_vs_https(self):
        """HTTP and HTTPS are different protocols, must not collapse."""
        self.assertDifferentSubscription(
            "https://example.com/feed",
            "http://example.com/feed"
        )

    def test_different_sub_different_filenames(self):
        self.assertDifferentSubscription(
            "https://example.com/rss.xml",
            "https://example.com/atom.xml"
        )

    def test_different_sub_different_hosts(self):
        self.assertDifferentSubscription(
            "https://alice.example.com/feed",
            "https://bob.example.com/feed"
        )

    def test_different_sub_non_default_port_kept(self):
        """Non-default ports are preserved, so they remain different subscriptions."""
        self.assertDifferentSubscription(
            "https://example.com:8443/feed",
            "https://example.com/feed"
        )

    def test_non_tracking_param_preserved(self):
        """Non-tracking query params must be preserved and affect identity."""
        na = normalize_feed_url_syntactic("https://example.com/feed?page=2")
        nb = normalize_feed_url_syntactic("https://example.com/feed?page=3")
        self.assertNotEqual(na, nb)

    def test_real_param_kept_after_tracking_strip(self):
        """After removing tracking params, remaining real params stay and affect identity."""
        na = normalize_feed_url_syntactic("https://example.com/feed?utm_source=x&keep=1")
        nb = normalize_feed_url_syntactic("https://example.com/feed?keep=1")
        nc = normalize_feed_url_syntactic("https://example.com/feed")
        self.assertEqual(na, nb)
        self.assertNotEqual(nb, nc)


if __name__ == "__main__":
    unittest.main()
