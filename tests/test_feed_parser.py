"""
Unit tests for Feed Parsing & Resilience in Commonplace (PS-003)
Verifies RSS 2.0, Atom 1.0, and malformed XML handling across real-world fixtures.
"""

import os
import unittest
import xml.etree.ElementTree as ET

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def parse_feed_safely(file_name: str):
    file_path = os.path.join(FIXTURES_DIR, file_name)
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    try:
        root = ET.fromstring(content)
        # Check format
        is_atom = "feed" in root.tag.lower()
        is_rss = "rss" in root.tag.lower() or "channel" in root.tag.lower()

        entries = []
        if is_atom:
            for entry in root.findall("{http://www.w3.org/2005/Atom}entry"):
                title_el = entry.find("{http://www.w3.org/2005/Atom}title")
                id_el = entry.find("{http://www.w3.org/2005/Atom}id")
                updated_el = entry.find("{http://www.w3.org/2005/Atom}updated")
                entries.append({
                    "title": title_el.text if title_el is not None else "Untitled",
                    "id": id_el.text if id_el is not None else None,
                    "date": updated_el.text if updated_el is not None else None
                })
        elif is_rss:
            ch = root.find("channel")
            channel = ch if ch is not None else root
            for item in channel.findall("item"):
                title_el = item.find("title")
                guid_el = item.find("guid")
                pubdate_el = item.find("pubDate")
                entries.append({
                    "title": title_el.text if title_el is not None else "Untitled",
                    "id": guid_el.text if guid_el is not None else None,
                    "date": pubdate_el.text if pubdate_el is not None else None
                })

        return {"status": "ok", "entries": entries}
    except ET.ParseError as e:
        return {"status": "error", "message": str(e)}


class TestFeedParserFixtures(unittest.TestCase):

    def test_parse_rss2_fixture(self):
        """RSS 2.0 fixture must parse with title and entries."""
        res = parse_feed_safely("rss2.xml")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(len(res["entries"]), 2)
        self.assertEqual(res["entries"][0]["title"], "Catching up with SQLite improvements")
        self.assertIsNotNone(res["entries"][0]["id"])
        self.assertIsNotNone(res["entries"][0]["date"])

    def test_parse_atom_fixture(self):
        """Atom 1.0 fixture must parse entries with atom namespaces."""
        res = parse_feed_safely("atom.xml")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(len(res["entries"]), 1)
        self.assertEqual(res["entries"][0]["title"], "Post-mortems and cultural resilience")
        self.assertIn("post-mortems", res["entries"][0]["id"])

    def test_handle_malformed_xml_gracefully(self):
        """Malformed XML must return error status without crashing application."""
        res = parse_feed_safely("malformed.xml")
        self.assertEqual(res["status"], "error")
        self.assertIn("message", res)

    def test_handle_missing_dates_deterministically(self):
        """Missing dates must be null rather than invented dates."""
        res = parse_feed_safely("missing_dates.xml")
        self.assertEqual(res["status"], "ok")
        self.assertEqual(len(res["entries"]), 1)
        self.assertIsNone(res["entries"][0]["date"])


if __name__ == "__main__":
    unittest.main()
