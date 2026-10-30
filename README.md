# COMMONPLACE (PS-003)
### A Privacy-First, Offline-First Reader with Anonymous Community Discovery

**Commonplace** is a browser-first RSS/Atom reading journal and anonymous publication discovery engine. It combines local-first reading autonomy with a transparent, privacy-respecting publication recommender.

---

## 1. Visual & 3D Interactive Design System

The application features a tactile 3D interactive reading interface built around an exact high-contrast palette:

| Colour | Hex | Usage |
|:---|:---|:---|
| **Midnight Black** | `#080A12` | Dominant background canvas, deep surface layers, sidebar, navigation |
| **Electric Cobalt Blue** | `#315BFF` | Interactive highlights, links, co-subscription filaments, active states |
| **Acid Lime** | `#C7FF3D` | Key status accents, "Saved Offline" pills, active pulses, focus indicators |

### 3D Interactive Features
- **3D Interactive Discovery Cosmos**: A 3D interactive constellation (`/static/js/components/canvas3d.js`) visualizing publications floating in a Midnight Black void with Electric Cobalt orbit filaments and Acid Lime pulses. Supports mouse drag orbit, zoom, and node raycasting to inspect recommendation receipts.
- **Tactile 3D Feed Cards**: Timeline cards feature realistic perspective depth tilts (`perspective(1000px) rotateX(...) rotateY(...)`) that respond to pointer movement.
- **3D Digital Reading Bookmark**: A physical-style 3D ribbon pinned into the article margin that restores scroll positions stored in IndexedDB.
- **Accessibility & Reduced Motion**: Automatically detects `prefers-reduced-motion: reduce` and provides a clean, flat 2D fallback without animations or expensive matrix calculations.

---

## 2. Core Technical Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BROWSER APPLICATION                             │
│                                                                        │
│  ┌───────────────────────┐   ┌───────────────────────────────────────┐ │
│  │ 3D Interactive UI     │   │ Reader & Timeline (DOMPurify Sink)    │ │
│  │ • Midnight Black      │   │ • Remote assets blocked by default    │ │
│  │ • Electric Cobalt     │   │ • Per-article "Load images" toggle    │ │
│  │ • Acid Lime           │   │ • Reading bookmarks in IndexedDB      │ │
│  └───────────┬───────────┘   └───────────────────┬───────────────────┘ │
│              │                                   │                     │
│  ┌───────────▼───────────────────────────────────▼───────────────────┐ │
│  │ Service Worker (Application Shell Caching & True Offline Reload)  │ │
│  │ • Caches HTML, CSS, JS, 3D Assets, Icons, Manifest                │ │
│  │ • NEVER caches /api/fetch or /api/discovery                       │ │
│  └───────────────────────────────┬───────────────────────────────────┘ │
│                                  │                                     │
│  ┌───────────────────────────────▼───────────────────────────────────┐ │
│  │ IndexedDB Storage Layer (idb)                                     │ │
│  │ • subscriptions  • entries  • readingState  • cachedArticles      │ │
│  │ • aliases (evidence-backed URL identity)                          │ │
│  └───────────────────────────────┬───────────────────────────────────┘ │
└──────────────────────────────────┼─────────────────────────────────────┘
                                   │ HTTP (Local loopback or intranet)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND SERVER (Python/Flask)                   │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Hardened Raw Fetch Proxy (/api/fetch)                            │  │
│  │ • Socket-level destination IP resolution & CIDR validation       │  │
│  │ • True IP-pinning (outbound connection bound to validated IP)    │  │
│  │ • DNS Rebinding immune; blocks RFC1918, Loopback, Link-Local,   │  │
│  │   IPv6 mapped, Cloud metadata (169.254.169.254)                  │  │
│  │ • Re-validates every redirect hop (max 3)                        │  │
│  │ • 5 MB streaming limit, 8-second hard timeout                   │  │
│  │ • Returns raw bytes & redirect metadata; no cookie forwarding    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Anonymous Discovery Engine (/api/discovery)                      │  │
│  │ • Batch sharing requires EXPLICIT user action                    │  │
│  │ • Strips IP/User-Agent; never stores raw batches or client IDs   │  │
│  │ • Deduplicates URLs per batch; increments aggregate B(F) & C(F,S)│  │
│  │ • Deterministic recommendation formula with receipt explanations │  │
│  │ • Minimum-support threshold K=2; strictly excludes user's feeds  │  │
│  │ • Visibly tags synthetic demo data (is_synthetic = true)         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Security, Privacy, and Data Integrity Contracts

1. **SSRF & DNS-Rebinding Hardening**:
   - Outbound connections are bound directly to the resolved numerical IP address at the socket level.
   - Comprehensive CIDR rejection: loopback (`127.0.0.0/8`, `::1`), private RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local / cloud metadata (`169.254.169.254`, `fe80::/10`), carrier-grade NAT, and IPv4-mapped IPv6 (`::ffff:0:0/96`).
   - Every redirect hop is re-validated and re-pinned (up to 3 hops maximum).
2. **Reader Privacy Boundary**:
   - Remote images, embeds, audio/video, and external fonts are blocked by default.
   - Replaced with local Midnight Black placeholders with Electric Cobalt borders.
   - Explicit per-article action: "Load Remote Images" with privacy disclosure.
   - External links strictly isolated with `rel="noopener noreferrer nofollow"` and `referrerpolicy="no-referrer"`.
   - Zero prefetching of articles or recommendation links.
3. **Anonymous Discovery Counting Semantics**:
   - Popularity is defined as **accepted anonymous submission batches**, never "unique readers".
   - Sharing is off by default and requires an explicit "Share Subscription Batch" click.
   - Feeds are deduplicated within each batch before updating counters.
   - No device fingerprints, client tokens, tracking cookies, or raw batch histories are stored.
   - Bounded pair contribution ($C \le 1$ per batch).
   - Minimum-support threshold ($K \ge 2$).
   - Transparent recommendation receipts generated from fixed deterministic templates.
4. **Offline Reliability**:
   - Service Worker caches the application shell.
   - IndexedDB stores subscriptions, entries, read/saved states, and cached article bodies.
   - Service Worker never caches `/api/fetch` or `/api/discovery`.
   - Tested offline restart: closing the page, disabling networking, and navigating back loads the shell, timeline, and saved articles.
5. **Seed Data Integrity**:
   - The organizer seed list audit status is marked **BLOCKED** because the file was not supplied in the environment.
   - Synthetic demo batches are tagged with `is_synthetic = True` and visibly labeled as "Demo Data (Seeded)".

---

## 4. Running the Application

### Prerequisites
- Python 3.10+ (Python 3.14 recommended)
- Dependencies: `Flask`, `Werkzeug`, `requests` (installed)

### Start the Server
```powershell
cd C:\Users\prady\.gemini\antigravity\scratch\commonplace
python server/app.py
```
The server will start at `http://127.0.0.1:5000`.

### Open in Browser
Open `http://localhost:5000` or `http://127.0.0.1:5000` in Google Chrome, Microsoft Edge, or Mozilla Firefox.

### Keyboard Shortcuts
- `j` / `k`: Next / Previous article
- `s`: Save / Unsave current article
- `m`: Mark read / unread
- `r`: Refresh all subscribed feeds
- `d`: Open 3D Discovery Cosmos
- `Esc`: Close article reader or modals

---

## 5. Running the Test Suite

Run all 24 unit and integration tests:

```powershell
python -m unittest discover tests
```

To run individual test suites:
- **SSRF Hardening Tests**: `python -m unittest tests.test_ssrf`
- **Discovery & Recommendation Tests**: `python -m unittest tests.test_discovery`
- **Feed Parser & Format Resilience Tests**: `python -m unittest tests.test_feed_parser`
- **Server API & Security Header Tests**: `python -m unittest tests.test_server_api`

All 24 tests run deterministically and pass with 0 failures.

---

## 6. Acceptance Matrix

See [docs/acceptance-matrix.md](file:///C:/Users/prady/.gemini/antigravity/scratch/commonplace/docs/acceptance-matrix.md) for the complete evidence-based matrix tracking all 18 requirements.
