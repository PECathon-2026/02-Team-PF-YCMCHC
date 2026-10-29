# Commonplace Backend

The backend powers the Commonplace application and exposes the HTTP API
used by the frontend. The project snippets indicate a Flask-based web
server and API gateway for RSS/Atom feed retrieval, feed autodiscovery,
and feed discovery.

## Responsibilities

-   Serve the application or expose API endpoints to the frontend.
-   Validate and normalize incoming feed/site URLs.
-   Discover RSS and Atom feed locations.
-   Retrieve and parse permitted feeds.
-   Return consistent JSON responses and useful HTTP status codes.
-   Enforce privacy, network-safety, and resource limits.

## Suggested structure

``` text
backend/
├── app/
│   ├── __init__.py
│   ├── routes/
│   │   ├── feeds.py
│   │   ├── autodiscover.py
│   │   └── discovery.py
│   ├── services/
│   │   ├── feed_parser.py
│   │   ├── feed_discovery.py
│   │   └── url_validator.py
│   └── config.py
├── tests/
│   ├── test_api.py
│   ├── test_autodiscover.py
│   ├── test_security.py
│   └── test_feeds.py
├── requirements.txt
├── run.py
└── .env.example
```

Use the structure that matches the existing repository. If the Flask
application currently lives at the repository root, do not move files
solely to match this example.

## Requirements

-   Python 3.10+ (use the version selected by the project and CI).
-   pip.
-   Dependencies listed in `requirements.txt`.
-   A supported local environment for running the Flask server and
    tests.

## Setup

From the backend directory:

``` bash
python -m venv .venv
```

Activate the environment:

``` bash
# Windows PowerShell
.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate
```

Install dependencies:

``` bash
pip install -r requirements.txt
```

If the application requires environment variables, copy `.env.example`
to `.env` and fill in local values. Never commit `.env` or real
credentials.

## Run the server

Use the entry point provided by the project. For example:

``` bash
python run.py
```

If your project uses the Flask CLI instead, document the exact command
here, such as:

``` bash
flask --app app run --debug
```

Do not run Flask's debug server in production.

## API endpoints

The following are example routes reflected in the Commonplace project
brief and supplied code fragments. Confirm the actual route names and
response schemas in the implementation.

  -----------------------------------------------------------------------
  Endpoint                            Purpose
  ----------------------------------- -----------------------------------
  `GET /api/health`                   Basic service health response, if
                                      implemented.

  `GET /api/autodiscover?url=...`     Discover a feed associated with a
                                      website URL.

  `GET /api/fetch?url=...`            Retrieve and parse a permitted
                                      RSS/Atom feed.

  `GET /api/discovery`                Return feed discovery suggestions,
                                      if implemented.
  -----------------------------------------------------------------------

### Expected validation behaviour

-   Missing required parameters should return `400 Bad Request`.
-   Invalid or prohibited destinations should return an appropriate
    client error (the supplied test expects `403` for a loopback
    destination).
-   Unexpected upstream failures should return a controlled error
    response.
-   Responses should use consistent JSON fields and avoid leaking stack
    traces or secrets.

## Security requirements

Feed URLs are user-controlled network destinations. SSRF protection is
essential.

-   Permit only `http` and `https` schemes.
-   Reject loopback, private, link-local, multicast, and reserved IP
    addresses.
-   Resolve hostnames and validate resolved addresses before connecting.
-   Revalidate every redirect target; do not allow a public URL to
    redirect to a private destination.
-   Consider DNS rebinding and time-of-check/time-of-use risks.
-   Apply connection and read timeouts, response-size limits, and
    sensible redirect limits.
-   Validate content types and parse XML safely; disable unsafe external
    entity processing.
-   Sanitize or safely encode feed content before it reaches the
    frontend.
-   Do not expose secrets, internal paths, or detailed exception traces
    in API responses.

A test that blocks `127.0.0.1` is useful but is not sufficient by itself
to prove complete SSRF protection.

## Testing

Run the test suite from the repository root or backend directory,
depending on the test configuration:

``` bash
python -m unittest discover -s tests -v
```

If the project uses pytest:

``` bash
pytest -q
```

Recommended coverage:

-   Health endpoint and JSON response shape.
-   Missing and malformed autodiscovery parameters.
-   Loopback, private, link-local, IPv6, and reserved destination
    blocking.
-   Redirects to prohibited destinations.
-   DNS resolution failures and timeouts.
-   Valid RSS and Atom parsing.
-   Malformed XML, empty feeds, unexpected content types, and oversized
    responses.
-   Consistent error handling for upstream failures.

## Configuration and secrets

Keep configuration in environment variables or a dedicated configuration
module. Commit `.env.example` with placeholder values only. Add `.env`,
local databases, logs, virtual environments, and generated files to
`.gitignore`.

## Notes for contributors

Keep route handlers small and move network and parsing logic into
services. Add tests for every security-sensitive change. Update the API
documentation in `../docs/` whenever an endpoint or response schema
changes.

This README is a template based on the project description and code
excerpts provided. Verify all paths, commands, dependencies, and
endpoint behaviour against the actual source before publishing.
