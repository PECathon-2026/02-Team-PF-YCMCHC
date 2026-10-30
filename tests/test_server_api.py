"""
Integration test suite for Commonplace Flask Web Server & API Gateway
Verifies:
- Security headers (nosniff, DENY, no-referrer)
- Service worker headers (Service-Worker-Allowed, no-cache)
- Discovery share & recommendation endpoints
- Seed audit status endpoint
"""

import json
import unittest
from server.app import app


class TestServerAPI(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()

    def test_security_headers_present(self):
        """All responses must include nosniff, DENY, and no-referrer headers."""
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(res.headers.get("X-Frame-Options"), "DENY")
        self.assertEqual(res.headers.get("Referrer-Policy"), "no-referrer")

    def test_service_worker_route(self):
        """Service worker must be served at /sw.js with Service-Worker-Allowed header."""
        res = self.client.get("/sw.js")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("Service-Worker-Allowed"), "/")
        self.assertIn("application/javascript", res.headers.get("Content-Type"))

    def test_discovery_recommendations_endpoint(self):
        """Recommendations endpoint must return JSON with recommendations and disclosure."""
        res = self.client.get("/api/discovery/recommendations?mode=popular")
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data.decode("utf-8"))
        self.assertIn("recommendations", data)
        self.assertIn("disclosure", data)
        self.assertIn("batches", data["disclosure"].lower())

    def test_discovery_share_endpoint(self):
        """Explicit batch submission must accept valid batches and reject empty payloads."""
        # Empty payload
        res_empty = self.client.post(
            "/api/discovery/share",
            data=json.dumps({"feedUrls": []}),
            content_type="application/json"
        )
        self.assertEqual(res_empty.status_code, 400)

        # Valid payload
        res_valid = self.client.post(
            "/api/discovery/share",
            data=json.dumps({
                "feedUrls": ["https://simonwillison.net/atom/everything/"]
            }),
            content_type="application/json"
        )
        self.assertEqual(res_valid.status_code, 200)
        data = json.loads(res_valid.data.decode("utf-8"))
        self.assertEqual(data["status"], "accepted")

    def test_seed_status_endpoint(self):
        """Seed status endpoint must report audit state cleanly."""
        res = self.client.get("/api/discovery/seed-status")
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data.decode("utf-8"))
        self.assertIn("status", data)

    def test_autodiscover_missing_param(self):
        """Autodiscover without url parameter must return 400 Bad Request."""
        res = self.client.get("/api/autodiscover")
        self.assertEqual(res.status_code, 400)

    def test_autodiscover_blocks_private_destinations(self):
        """Autodiscover to loopback/private destinations must be blocked by SSRF filter."""
        res = self.client.get("/api/autodiscover?url=http://127.0.0.1/feed.xml")
        self.assertEqual(res.status_code, 403)


if __name__ == "__main__":
    unittest.main()
