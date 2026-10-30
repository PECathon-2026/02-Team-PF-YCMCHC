# 53-Team-PF-YCMCHC
Commonplace: Web Feed Discovery & Reader Platform

Commonplace is a secure, installable web application that turns any website address into a usable RSS/Atom feed. It pairs a Flask-based API gateway with an offline-capable Progressive Web App (PWA), giving users one place to discover feeds and fetch their content, with SSRF protections built into every outbound request.

Hackathon project · Problem Statement 3

Key Highlights
One-Step Feed Autodiscovery: Paste any site URL and /api/autodiscover resolves the feed URL, a suggested title and the canonical site URL as clean JSON.
SSRF-Hardened Gateway: Every user-supplied URL is validated before the server touches it. Requests to loopback and private network destinations (for example http://127.0.0.1/...) are rejected with 403 Forbidden.
Strict Input Validation: Missing or malformed parameters return explicit HTTP status codes (400, 403) instead of failing silently.
Offline-Ready PWA:
Versioned App-Shell Caching: A service worker precaches the interface so the app loads without a network connection.
Live Data Guarantee: Dynamic routes (/api/fetch, /api/discovery) are never runtime-cached, so feed data is always fresh.
Server-Side Fetching: The backend fetches feeds on the client's behalf, avoiding browser cross-origin restrictions.
Automated Integration Tests: A unittest suite verifies API responses, parameter validation and SSRF blocking.
System Architecture
                    +---------------------------------------+
                    |         Commonplace Frontend          |
                    |        (Installable PWA Client)       |
                    |   - Add feed by site URL              |
                    |   - Feed reader views                 |
                    |   - Service Worker (offline shell)    |
                    +-------------------+-------------------+
                                        |
                                  HTTP REST / JSON
                                        |
                                        v
                    +---------------------------------------+
                    |      Commonplace Flask API Gateway    |
                    |   - Request routing & validation      |
                    |   - /api/autodiscover                 |
                    |   - /api/fetch, /api/discovery        |
                    +---------+-------------------+---------+
                              |                   |
              +---------------+                   +----------------+
              |                                                    |
              v                                                    v
+--------------------------------------+        +--------------------------------------+
|        URL Validation & Security     |        |        Feed Discovery Module         |
|  - SSRF filter                       |        |  - Resolves site URL to feed URL     |
|  - Blocks loopback / private hosts   |        |  - Returns suggested title + site    |
|  - Returns 400 / 403 on bad input    |        |                                      |
+--------------------------------------+        +--------------------------------------+
Directory Overview

Adjust file and folder names to match the repository.

Commonplace/
├── README.md                 # Root documentation (this file)
├── README-backend.md         # Backend architecture and API guide
├── README-frontend.md        # PWA, service worker and UI guide
├── requirements.txt          # Python dependencies
├── [app.py]                  # Flask app, routes, URL validation
├── static/                   # Frontend assets
│   ├── manifest.json         # PWA manifest
│   └── sw.js                 # Service worker (app-shell caching)
└── tests/                    # Integration test suite
    └── [test_server.py]
Quick Start
1. Prerequisites
Python: 3.10 or higher
pip: latest recommended
Browser: Chrome or Edge recommended for testing PWA install and the service worker
2. Start the Server
bash
git clone [your-repo-url]
cd Commonplace

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
flask --app [app-file] run --debug

The server boots on http://127.0.0.1:5000 and serves both the API and the frontend.

3. Open the App

Visit http://127.0.0.1:5000 in your browser. localhost counts as a secure context, so the service worker and install prompt work without HTTPS.

4. Run the Tests
bash
python -m unittest discover -v
Operational Workflows
1. Discover a Feed from a Website
Enter a website address (for example https://example.com) in the add-feed field.
The client calls GET /api/autodiscover?url=<site_url>.
The backend validates the URL, then searches the site for its feed.
The response returns the feed details:
json
{
  "resolvedFeedUrl": "https://example.com/feed.xml",
  "suggestedTitle": "",
  "siteUrl": "https://example.com"
}
2. Blocked and Invalid Requests
Scenario	Result
url parameter missing	400 Bad Request
URL points to a loopback or private address	403 Forbidden (SSRF filter)
Valid public URL	200 OK with JSON
3. Install and Use Offline
Open the app in Chrome or Edge and choose Install from the address bar.
The service worker precaches the app shell on first load.
Go offline and reopen the app. The interface still loads.
Discovery and feed fetching resume when the connection returns, because those routes always go to the network.
4. Release a New Frontend Version
Change any app-shell asset.
Bump CACHE_NAME in sw.js (for example commonplace-shell-v1.3 to v1.4).
Reload twice, or use DevTools → Application → Service Workers → Update on reload.
API Reference
Method	Endpoint	Description
GET	/api/autodiscover?url=<site_url>	Discovers a feed from a website URL
GET	/api/fetch	Fetches feed content through the gateway
GET	/api/discovery	Feed discovery endpoint

/api/fetch and /api/discovery are excluded from service-worker caching by design.

Security
All user-supplied URLs are validated before any outbound request.
Loopback (127.0.0.0/8, ::1) and private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) are blocked.
Invalid requests are rejected with explicit status codes.
Sensitive configuration and internal errors are never exposed in responses.
Dynamic API responses are never cached.
Tech Stack
Frontend: HTML, CSS, JavaScript, Service Worker API, Web App Manifest
Backend: Python, Flask
Integration: RESTful JSON APIs
Testing: Python unittest
Version Control: Git and GitHub
Future Scope
Improve feed discovery accuracy and reliability
Add feed management (save, organize and group feeds)
Enhance the user interface and experience
Expand automated testing and security validation
Improve offline functionality and performance





Thanks to the hackathon organizers, mentors and contributors for their guidance and support.

License & Attribution

Developed as part of a hackathon initiative. Licensing and attribution are subject to the project's selected license and applicable third-party requirements.
