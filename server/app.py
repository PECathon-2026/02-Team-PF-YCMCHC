"""
Commonplace Web Server & API Gateway
Provides:
- SSRF-hardened raw fetch proxy (/api/fetch)
- Anonymous discovery API (/api/discovery/...)
- PWA application shell & Service Worker hosting
"""

import json
import os
import sys

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from flask import Flask, request, Response, jsonify, send_from_directory
from server.fetch_proxy import safe_fetch_url, SecurityException
from server.discovery import (
    record_anonymous_batch,
    compute_recommendations,
    get_system_stats,
    init_db
)
from server.seed_data import audit_organizer_seed, ensure_seeded_idempotent

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # Disable static caching during local dev

# Ensure DB & Seed initialization
init_db()
ensure_seeded_idempotent()


@app.after_request
def apply_security_headers(response: Response) -> Response:
    """Apply strict security and privacy headers to all responses."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


# --- PWA & Static Routes ---

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/sw.js")
def service_worker():
    response = send_from_directory(STATIC_DIR, "sw.js", mimetype="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


# --- Hardened Fetch Proxy ---

@app.route("/api/fetch", methods=["GET"])
def proxy_fetch():
    """
    Hardened raw fetch proxy:
    - GET only
    - Validates IPv4/IPv6, rejects private/loopback/cloud metadata
    - Pins outbound socket directly to validated IP
    - Returns raw response bytes without forwarding upstream cookies
    """
    target_url = request.args.get("url")
    if not target_url:
        return jsonify({"error": "Missing 'url' query parameter"}), 400

    try:
        result = safe_fetch_url(target_url)

        # Allowlisted content types
        resp = Response(
            result["body"],
            status=result["status_code"],
            mimetype=result["content_type"]
        )
        resp.headers["Cache-Control"] = "no-store, private"
        resp.headers["X-Final-Url"] = result["final_url"]
        resp.headers["X-Redirect-Count"] = str(len(result["redirect_hops"]))
        resp.headers["X-Redirect-Hops"] = json.dumps(result["redirect_hops"])
        resp.headers["Access-Control-Expose-Headers"] = "X-Final-Url, X-Redirect-Count, X-Redirect-Hops"
        return resp

    except SecurityException as e:
        return jsonify({
            "error": "Security Policy Violation",
            "message": str(e)
        }), 403
    except ValueError as e:
        return jsonify({
            "error": "Malformed Request or Upstream Protocol Error",
            "message": str(e)
        }), 400
    except TimeoutError:
        return jsonify({
            "error": "Upstream Timeout",
            "message": "The upstream feed host did not respond within the 8-second limit."
        }), 504
    except Exception as e:
        return jsonify({
            "error": "Fetch Error",
            "message": "Failed to retrieve the requested resource."
        }), 502


# --- Intelligent Feed Autodiscovery Route ---

@app.route("/api/autodiscover", methods=["GET"])
def autodiscover_feed():
    """
    Intelligently discovers RSS or Atom feeds from any blog website URL.
    - If target is directly XML, returns it.
    - If target is HTML, parses <link rel="alternate" type="application/rss+xml" ...>
    - Probes standard feed paths if link tags are absent.
    """
    import re
    import urllib.parse

    raw_url = request.args.get("url", "").strip()
    if not raw_url:
        return jsonify({"error": "Missing 'url' query parameter"}), 400

    # Ensure valid scheme
    if not raw_url.startswith(("http://", "https://")):
        raw_url = "https://" + raw_url

    try:
        result = safe_fetch_url(raw_url)
        content_type = result.get("content_type", "").lower()
        final_url = result.get("final_url", raw_url)
        body = result.get("body", b"")

        # 1. Check if response is directly RSS or Atom XML
        body_text_preview = body[:2000].decode("utf-8", errors="replace").lower()
        if any(marker in body_text_preview for marker in ["<rss", "<feed", "<rdf:rdf"]) or "xml" in content_type:
            # Extract title if present
            title_match = re.search(r"<title[^>]*>(.*?)</title>", body_text_preview, re.IGNORECASE | re.DOTALL)
            title = title_match.group(1).strip() if title_match else final_url
            return jsonify({
                "found": True,
                "feedUrl": final_url,
                "title": title,
                "siteUrl": final_url,
                "isDirect": True
            })

        # 2. Response is HTML: look for <link rel="alternate" type="application/rss+xml" ...>
        html_str = body[:50000].decode("utf-8", errors="replace")
        
        # Regex for <link ... rel="alternate" ... href="..." >
        link_matches = re.findall(r'<link\s+[^>]*rel=["\']alternate["\'][^>]*>', html_str, re.IGNORECASE)
        # Also check reversed attribute order: type first or href first
        link_matches += re.findall(r'<link\s+[^>]*type=["\'](?:application/rss\+xml|application/atom\+xml|text/xml)["\'][^>]*>', html_str, re.IGNORECASE)

        for tag in link_matches:
            if re.search(r'type=["\'](?:application/rss\+xml|application/atom\+xml|text/xml)["\']', tag, re.IGNORECASE):
                href_match = re.search(r'href=["\']([^"\']+)["\']', tag, re.IGNORECASE)
                if href_match:
                    feed_href = href_match.group(1).strip()
                    resolved_feed_url = urllib.parse.urljoin(final_url, feed_href)
                    
                    title_match = re.search(r'title=["\']([^"\']+)["\']', tag, re.IGNORECASE)
                    feed_title = title_match.group(1).strip() if title_match else ""
                    if not feed_title:
                        page_title = re.search(r'<title[^>]*>(.*?)</title>', html_str, re.IGNORECASE | re.DOTALL)
                        feed_title = page_title.group(1).strip() if page_title else final_url

                    return jsonify({
                        "found": True,
                        "feedUrl": resolved_feed_url,
                        "title": feed_title,
                        "siteUrl": final_url,
                        "isDirect": False
                    })

        # 3. Probing common feed paths as fallback
        parsed = urllib.parse.urlparse(final_url)
        base_origin = f"{parsed.scheme}://{parsed.netloc}"
        candidate_paths = ["/feed", "/atom.xml", "/rss.xml", "/feed.xml", "/index.xml"]

        for path in candidate_paths:
            candidate_url = urllib.parse.urljoin(base_origin, path)
            try:
                probe_res = safe_fetch_url(candidate_url)
                probe_preview = probe_res.get("body", b"")[:1000].decode("utf-8", errors="replace").lower()
                if "<rss" in probe_preview or "<feed" in probe_preview:
                    return jsonify({
                        "found": True,
                        "feedUrl": candidate_url,
                        "title": parsed.netloc,
                        "siteUrl": final_url,
                        "isDirect": False,
                        "probed": True
                    })
            except Exception:
                continue

        return jsonify({
            "found": False,
            "message": "No RSS or Atom feed could be discovered for this URL. Please verify the publication feed URL."
        }), 404

    except SecurityException as e:
        return jsonify({"error": "Security Policy Violation", "message": str(e)}), 403
    except Exception as e:
        return jsonify({"error": "Autodiscovery Failed", "message": str(e)}), 502


# --- Anonymous Discovery Routes ---

@app.route("/api/discovery/share", methods=["POST"])
def share_batch():
    """
    Explicit user batch submission.
    Deduplicates URLs, updates aggregate co-subscription counts.
    Never stores IP, User-Agent, or raw batch histories.
    """
    if not request.is_json:
        return jsonify({"error": "Request body must be JSON"}), 400

    payload = request.get_json()
    feed_urls = payload.get("feedUrls", [])
    titles = payload.get("titles", {})

    if not isinstance(feed_urls, list) or len(feed_urls) == 0:
        return jsonify({"error": "feedUrls must be a non-empty array of URLs"}), 400

    # Cap batch size to prevent abuse (e.g. max 200 feeds per submission)
    if len(feed_urls) > 200:
        return jsonify({"error": "Batch size exceeds maximum limit of 200 feeds"}), 400

    outcome = record_anonymous_batch(feed_urls, titles=titles, is_synthetic=False)
    return jsonify(outcome), 200


@app.route("/api/discovery/recommendations", methods=["GET"])
def recommendations():
    """
    Computes feed recommendations:
    - Excludes user's subscriptions and verified aliases
    - Supported modes: 'related' (co-subscription) or 'popular'
    - Returns fixed template explanation receipts
    """
    user_feeds_raw = request.args.get("userFeeds", "")
    mode = request.args.get("mode", "related")
    limit = min(int(request.args.get("limit", 12)), 30)

    user_feeds = [f.strip() for f in user_feeds_raw.split(",") if f.strip()]
    recs = compute_recommendations(user_feed_urls=user_feeds, mode=mode, limit=limit)
    return jsonify({
        "mode": mode,
        "recommendations": recs,
        "count": len(recs),
        "disclosure": "Counts represent accepted anonymous batches, not verified unique readers."
    })


@app.route("/api/discovery/stats", methods=["GET"])
def discovery_stats():
    """Returns aggregate community discovery metrics."""
    return jsonify(get_system_stats())


@app.route("/api/discovery/seed-status", methods=["GET"])
def seed_status():
    """Reports status of organizer seed audit and synthetic demo dataset."""
    audit = audit_organizer_seed()
    return jsonify(audit)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
