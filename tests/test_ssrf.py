"""
Unit tests for SSRF Protection & Address Validation in Commonplace (PS-003)
"""

import ipaddress
import unittest
from server.fetch_proxy import (
    validate_ip_address,
    safe_fetch_url,
    SecurityException
)


class TestSSRFProtection(unittest.TestCase):

    def test_reject_loopback_ipv4(self):
        """Loopback 127.0.0.1 must be rejected."""
        ip = ipaddress.ip_address("127.0.0.1")
        with self.assertRaises(SecurityException) as ctx:
            validate_ip_address(ip)
        self.assertIn("loopback", str(ctx.exception).lower())

    def test_reject_cloud_metadata(self):
        """AWS/GCP/Azure link-local metadata 169.254.169.254 must be rejected."""
        ip = ipaddress.ip_address("169.254.169.254")
        with self.assertRaises(SecurityException) as ctx:
            validate_ip_address(ip)
        self.assertTrue(
            "link-local" in str(ctx.exception).lower() or
            "prohibited" in str(ctx.exception).lower()
        )

    def test_reject_private_rfc1918(self):
        """RFC 1918 addresses must be rejected."""
        private_ips = ["10.0.0.1", "172.16.5.10", "192.168.1.1"]
        for addr in private_ips:
            ip = ipaddress.ip_address(addr)
            with self.assertRaises(SecurityException) as ctx:
                validate_ip_address(ip)
            self.assertIn("private", str(ctx.exception).lower())

    def test_reject_ipv6_loopback_and_ula(self):
        """IPv6 ::1 and ULA fc00::/7 must be rejected."""
        for addr in ["::1", "fc00::1", "fe80::1"]:
            ip = ipaddress.ip_address(addr)
            with self.assertRaises(SecurityException):
                validate_ip_address(ip)

    def test_reject_ipv4_mapped_ipv6(self):
        """IPv4-mapped IPv6 pointing to 127.0.0.1 must be unpacked and rejected."""
        ip = ipaddress.ip_address("::ffff:127.0.0.1")
        with self.assertRaises(SecurityException):
            validate_ip_address(ip)

    def test_reject_credentials_in_url(self):
        """User credentials in URLs must be rejected before fetching."""
        with self.assertRaises(SecurityException) as ctx:
            safe_fetch_url("http://admin:secret@example.com/feed.xml")
        self.assertIn("credentials", str(ctx.exception).lower())

    def test_reject_non_standard_ports(self):
        """Non-standard ports (e.g. 22, 8080, 6379) must be rejected."""
        for port in [22, 6379, 8080]:
            with self.assertRaises(SecurityException) as ctx:
                safe_fetch_url(f"http://example.com:{port}/feed.xml")
            self.assertIn("port", str(ctx.exception).lower())

    def test_reject_unsupported_schemes(self):
        """Schemes other than http/https must be rejected."""
        for scheme in ["file:///etc/passwd", "ftp://example.com/feed", "gopher://evil"]:
            with self.assertRaises(SecurityException) as ctx:
                safe_fetch_url(scheme)
            self.assertIn("scheme", str(ctx.exception).lower())


if __name__ == "__main__":
    unittest.main()
