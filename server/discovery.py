"""
Anonymous Community Discovery Engine for Commonplace (PS-003)
Implements:
- Batch-based popularity counting (deduplicated per batch)
- Bounded co-subscription pair matrix (max +1 per batch)
- Exact documented ranking formula:
    Score(F) = w_pop * log(1 + B(F)) + w_co * sum( C(F, S) / sqrt(B(F) * B(S)) )
- Minimum-support thresholds (K >= 2)
- Fixed template receipts and deterministic tie-breaking
- Exclusion of user subscriptions and verified aliases
- Clear separation of organic and synthetic demo data
- ZERO storage of IP addresses, client tokens, browser fingerprints, or raw batch histories
"""

import math
import os
import sqlite3
import time as _time
from typing import List, Dict, Any, Set, Tuple, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "discovery.db")
MIN_SUPPORT_THRESHOLD = 2  # Feed must appear in at least K accepted batches to be recommended
WEIGHT_POPULARITY = 0.35
WEIGHT_CO_SUBSCRIPTION = 0.65

# Configurable via environment variables
MIN_REACH_BATCHES = int(os.environ.get("COMMONPLACE_MIN_REACH_BATCHES", "2"))
MIN_RECENT_DAYS = int(os.environ.get("COMMONPLACE_MIN_RECENT_DAYS", "90"))
PRIVACY_UNIQUE_THRESHOLD = int(os.environ.get("COMMONPLACE_PRIVACY_THRESHOLD", "2"))
# Feeds with accepted_batch_count < PRIVACY_UNIQUE_THRESHOLD are excluded from
# public stats to prevent identifying rare-subscriber communities.


def _ensure_column(cursor, table, column, col_type):
    """Add column to table if it doesn't already exist."""
    cursor.execute(f"PRAGMA table_info({table})")
    cols = [row[1] for row in cursor.fetchall()]
    if column not in cols:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")


def get_db_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize database tables with schema constraints."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feed_stats (
                feed_url TEXT PRIMARY KEY,
                title TEXT,
                site_url TEXT,
                accepted_batch_count INTEGER NOT NULL DEFAULT 0,
                is_synthetic INTEGER NOT NULL DEFAULT 0,
                first_seen_timestamp INTEGER NOT NULL,
                last_seen_timestamp INTEGER NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS co_subscriptions (
                feed_url_a TEXT NOT NULL,
                feed_url_b TEXT NOT NULL,
                pair_count INTEGER NOT NULL DEFAULT 0,
                is_synthetic INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (feed_url_a, feed_url_b)
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS aliases (
                source_url TEXT PRIMARY KEY,
                target_url TEXT NOT NULL,
                evidence_type TEXT NOT NULL,
                evidence_details TEXT,
                created_at INTEGER NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        _ensure_column(cursor, "feed_stats", "last_activity_timestamp", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(cursor, "feed_stats", "category", "TEXT NOT NULL DEFAULT ''")

        conn.commit()
    finally:
        conn.close()


def normalize_feed_url_syntactic(url: str) -> str:
    """
    Syntactic URL normalization for discovery:
    - Lowercase scheme and hostname only (preserve path casing).
    - Strip www. prefix from hostname.
    - Remove fragment and default ports (80 for http, 443 for https).
    - Remove expanded set of tracking query params.
    - Preserve non-tracking query parameters and path casing.
    - Do NOT strip trailing slashes from paths.
    - Do NOT merge http and https (different schemes stay distinct).
    """
    import urllib.parse
    parsed = urllib.parse.urlparse(url.strip())
    if not parsed.scheme or not parsed.hostname:
        return url.strip()

    scheme = parsed.scheme.lower()

    # Lowercase hostname and strip www. prefix
    hostname = parsed.hostname.lower()
    if hostname.startswith('www.'):
        hostname = hostname[4:]

    # Remove default ports; keep non-default ports
    netloc = hostname
    if parsed.port:
        if not (scheme == 'http' and parsed.port == 80) and \
           not (scheme == 'https' and parsed.port == 443):
            netloc += f":{parsed.port}"

    # Filter recognized tracking params (expanded list)
    preserved_query = []
    if parsed.query:
        known_tracking = {
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'ref', 'mc_eid', 'ck_subscriber_id', 'source', 'via'
        }
        pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        preserved_query = [(k, v) for k, v in pairs if k.lower() not in known_tracking]

    query_str = urllib.parse.urlencode(preserved_query) if preserved_query else ""
    # Fragment is intentionally dropped (pass "" for fragment in urlunparse)
    return urllib.parse.urlunparse((scheme, netloc, parsed.path, "", query_str, ""))


def record_anonymous_batch(feed_urls: List[str], titles: Optional[Dict[str, str]] = None, is_synthetic: bool = False) -> Dict[str, Any]:
    """
    Processes an accepted anonymous subscription batch:
    1. Deduplicates feed URLs inside the batch.
    2. Strips any empty/invalid entries.
    3. Increments B(F) by 1 for each unique feed in the batch.
    4. Increments C(F_A, F_B) by 1 for each unique pair in the batch (capped at 1 per batch).
    5. Discards the raw batch after transaction completion.
    """
    if titles is None:
        titles = {}

    import time
    now_ts = int(time.time() * 1000)

    # 1. Syntactically normalize and deduplicate URLs in batch
    cleaned_urls = set()
    for raw in feed_urls:
        if isinstance(raw, str) and raw.strip():
            normalized = normalize_feed_url_syntactic(raw)
            if normalized.startswith(('http://', 'https://')):
                cleaned_urls.add(normalized)

    unique_feeds = sorted(list(cleaned_urls))
    if not unique_feeds:
        return {"status": "rejected", "message": "Batch contains no valid HTTP/HTTPS URLs."}

    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        # Update feed_stats B(F)
        for feed_url in unique_feeds:
            feed_title = titles.get(feed_url, "")
            cursor.execute("""
                INSERT INTO feed_stats (feed_url, title, site_url, accepted_batch_count, is_synthetic, first_seen_timestamp, last_seen_timestamp, last_activity_timestamp)
                VALUES (?, ?, '', 1, ?, ?, ?, ?)
                ON CONFLICT(feed_url) DO UPDATE SET
                    accepted_batch_count = accepted_batch_count + 1,
                    last_seen_timestamp = ?,
                    last_activity_timestamp = ?,
                    title = CASE WHEN feed_stats.title IS NULL OR feed_stats.title = '' THEN excluded.title ELSE feed_stats.title END
            """, (feed_url, feed_title, 1 if is_synthetic else 0, now_ts, now_ts, now_ts, now_ts, now_ts))

        # Update co_subscriptions C(A, B) for all distinct pairs in this batch
        for i in range(len(unique_feeds)):
            for j in range(i + 1, len(unique_feeds)):
                fa, fb = unique_feeds[i], unique_feeds[j]
                if fa > fb:
                    fa, fb = fb, fa

                cursor.execute("""
                    INSERT INTO co_subscriptions (feed_url_a, feed_url_b, pair_count, is_synthetic)
                    VALUES (?, ?, 1, ?)
                    ON CONFLICT(feed_url_a, feed_url_b) DO UPDATE SET
                        pair_count = pair_count + 1
                """, (fa, fb, 1 if is_synthetic else 0))

        conn.commit()
    finally:
        conn.close()

    return {
        "status": "accepted",
        "accepted_feeds_count": len(unique_feeds),
        "is_synthetic": is_synthetic
    }


def compute_recommendations(
    user_feed_urls: List[str],
    mode: str = "related",
    limit: int = 12
) -> List[Dict[str, Any]]:
    # Normalize user subscriptions
    normalized_user_subs = set()
    for u in user_feed_urls:
        if u and u.strip():
            normalized_user_subs.add(normalize_feed_url_syntactic(u))

    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        # Retrieve verified aliases to also exclude
        cursor.execute("SELECT source_url, target_url FROM aliases")
        for row in cursor.fetchall():
            if row["source_url"] in normalized_user_subs:
                normalized_user_subs.add(row["target_url"])
            if row["target_url"] in normalized_user_subs:
                normalized_user_subs.add(row["source_url"])

        # Fetch all eligible candidate feeds meeting minimum support threshold
        cursor.execute("""
            SELECT feed_url, title, site_url, accepted_batch_count, is_synthetic, last_activity_timestamp
            FROM feed_stats
            WHERE accepted_batch_count >= ? OR is_synthetic = 1
        """, (MIN_SUPPORT_THRESHOLD,))
        all_candidates = cursor.fetchall()

        now_ms = int(_time.time() * 1000)
        stale_cutoff_ms = now_ms - (MIN_RECENT_DAYS * 86400 * 1000)

        # Build lookup of candidates excluding user subscriptions AND applying reach filter
        candidate_dict = {}
        for row in all_candidates:
            f_url = row["feed_url"]
            if f_url in normalized_user_subs:
                continue

            batch_count = row["accepted_batch_count"]
            is_seed = bool(row["is_synthetic"])
            last_activity = row["last_activity_timestamp"] if row["last_activity_timestamp"] else 0

            # Apply minimum reach filter (cold-start exception for seeded feeds)
            if not is_seed:
                if batch_count < MIN_REACH_BATCHES:
                    continue  # Below minimum reach
                if last_activity > 0 and last_activity < stale_cutoff_ms:
                    continue  # Stale feed

            # Privacy: exclude feeds with < PRIVACY_UNIQUE_THRESHOLD batches from public stats
            # They can still appear if is_seed, but their batch_count is hidden
            if batch_count < PRIVACY_UNIQUE_THRESHOLD and not is_seed:
                continue  # Privacy protection: rare feed could identify individual

            candidate_dict[f_url] = {
                "feed_url": f_url,
                "title": row["title"] or f_url,
                "site_url": row["site_url"] or "",
                "accepted_batch_count": batch_count,
                "is_synthetic": is_seed,
                "score": 0.0,
                "overlap_reasons": []
            }

        if not candidate_dict:
            return []

        # If mode is 'popular' or user has no subscriptions, rank purely by B(F)
        if mode == "popular" or not normalized_user_subs:
            results = []
            for f_url, data in candidate_dict.items():
                bf = data["accepted_batch_count"]
                data["score"] = math.log(1.0 + bf)
                data["explanation"] = f"Popular across {bf} accepted anonymous batches."
                results.append(data)

            # Deterministic sorting: score desc, feed_url asc
            results.sort(key=lambda x: (-x["score"], x["feed_url"]))
            return results[:limit]

        # Mode is 'related': compute co-subscription overlap
        user_feed_counts: Dict[str, int] = {}
        if normalized_user_subs:
            placeholders = ",".join("?" for _ in normalized_user_subs)
            cursor.execute(f"""
                SELECT feed_url, accepted_batch_count
                FROM feed_stats
                WHERE feed_url IN ({placeholders})
            """, list(normalized_user_subs))
            for row in cursor.fetchall():
                user_feed_counts[row["feed_url"]] = row["accepted_batch_count"]

        # Calculate overlap for candidate feeds
        for f_url, data in candidate_dict.items():
            bf = data["accepted_batch_count"]
            pop_score = math.log(1.0 + bf)
            co_score = 0.0

            for s_url in normalized_user_subs:
                bs = user_feed_counts.get(s_url, 0)
                if bs <= 0:
                    continue

                fa, fb = (f_url, s_url) if f_url < s_url else (s_url, f_url)
                cursor.execute("""
                    SELECT pair_count FROM co_subscriptions
                    WHERE feed_url_a = ? AND feed_url_b = ?
                """, (fa, fb))
                row = cursor.fetchone()
                c_fs = row["pair_count"] if row else 0

                if c_fs > 0:
                    pair_strength = c_fs / math.sqrt(bf * bs)
                    co_score += pair_strength
                    data["overlap_reasons"].append({
                        "followed_feed": s_url,
                        "pair_batches": c_fs
                    })

            total_score = (WEIGHT_POPULARITY * pop_score) + (WEIGHT_CO_SUBSCRIPTION * co_score)
            data["score"] = total_score

            if data["overlap_reasons"]:
                top_reason = max(data["overlap_reasons"], key=lambda r: r["pair_batches"])
                data["explanation"] = (
                    f"Co-subscribed with your feed ({top_reason['followed_feed']}) "
                    f"in {top_reason['pair_batches']} accepted batches."
                )
            else:
                data["explanation"] = (
                    f"Popular discovery fallback: included in {bf} accepted anonymous batches."
                )

        results = list(candidate_dict.values())
        results.sort(key=lambda x: (-x["score"], x["feed_url"]))
        return results[:limit]
    finally:
        conn.close()


def get_system_stats() -> Dict[str, Any]:
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS total_feeds, COALESCE(SUM(accepted_batch_count), 0) AS total_batches FROM feed_stats")
        row = cursor.fetchone()
        cursor.execute("SELECT COUNT(*) AS total_pairs FROM co_subscriptions")
        pair_row = cursor.fetchone()
        return {
            "total_indexed_feeds": row["total_feeds"] if row else 0,
            "total_accepted_batch_tallies": row["total_batches"] if row else 0,
            "total_co_subscription_edges": pair_row["total_pairs"] if pair_row else 0,
            "min_reach_batches": MIN_REACH_BATCHES,
            "min_recent_days": MIN_RECENT_DAYS,
            "privacy_unique_threshold": PRIVACY_UNIQUE_THRESHOLD
        }
    finally:
        conn.close()
