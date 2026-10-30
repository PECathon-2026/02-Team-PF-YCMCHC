# Commonplace (PS-003) — Architecture & Security Boundaries

## 1. System Overview

Commonplace is designed around strict local-first autonomy and anonymous community discovery.

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
│  │ • Caches HTML, CSS, JS, 3D Assets, Fonts                          │ │
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

## 2. Shared Data Contracts

All data structures are typed and validated on boundary crossing:
- `Subscription`: Stores local feed record, verified status, and last failure diagnostics.
- `Entry`: Stable entry identified deterministically by feed `<guid>`, canonical URL, or SHA-256 fallback.
- `ReadingState`: Read/unread flag, saved status, scroll progress (0.0 to 1.0).
- `CachedArticle`: Extracted and sanitized article HTML with policy version.
- `AliasRecord`: Records evidence (validated redirect chain or inspected `<atom:link rel="self">`).

## 3. Threat Model & Security Boundaries

1. **SSRF & DNS Rebinding**:
   - Attack vector: Attacker submits feed URL resolving to internal IPs (e.g. `http://169.254.169.254/latest/meta-data/` or internal admin port) or uses DNS rebinding to switch to internal IP on secondary DNS query.
   - Defense: Address resolution is coupled to the connection socket. The socket connects directly to the resolved numerical IP address, preventing time-of-check to time-of-use (TOCTOU) DNS rebinding. Redirects are recursively validated.
2. **Reading Activity Leakage**:
   - Attack vector: Remote tracking pixels (`<img src="https://tracker.com/pixel.gif">`), web fonts, or CSS backgrounds embedded in syndicated feed content.
   - Defense: All external network assets blocked by default. Replaced with local CSS placeholders. User must explicitly click "Load Remote Images" for a single article.
3. **Sybil & Batch Inflation in Discovery**:
   - Attack vector: Malicious user repeatedly posts identical or inflated subscription lists.
   - Defense: Local last-shared batch hash prevents accidental repeated sharing. Server deduplicates within each batch. Pair co-subscription contribution is capped at 1 per batch. Counts are explicitly labeled "Accepted Anonymous Batches", never "Unique Readers".

## 4. Operational Logging Disclosures

- The server logs operational errors (e.g. invalid URLs, upstream timeout) for diagnostics.
- The server does NOT log client IP addresses in discovery batch tables.
- Upstream servers see requests originating from the Commonplace proxy IP address, not the client's direct browser IP address.
