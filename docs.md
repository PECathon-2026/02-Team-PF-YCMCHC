# Commonplace Documentation

This directory contains technical and project documentation for
**Commonplace**, a privacy-first, offline-first reader for RSS/Atom
subscriptions and anonymous, explainable feed discovery.

## What belongs here?

Keep project documentation in this folder so contributors, reviewers,
and maintainers can understand the system without having to inspect
every source file.

Suggested documents:

``` text
docs/
├── README.md
├── architecture.md
├── api.md
├── security.md
├── privacy.md
├── testing.md
└── screenshots/
```

Create only the documents that the project actually maintains. The list
above is a recommended documentation plan.

## Recommended documents

### `architecture.md`

Explain the major parts of the system and how they communicate:

-   Frontend and user interface.
-   Flask backend and API gateway.
-   RSS/Atom feed retrieval and parsing.
-   Local/offline application-shell behaviour.
-   Data storage and synchronization boundaries.
-   Feed discovery and how recommendations are explained.

Include a simple architecture diagram where useful.

### `api.md`

Document each implemented endpoint with:

-   HTTP method and route.
-   Purpose and required query parameters.
-   Example request.
-   Example success response.
-   Possible error responses and status codes.
-   Authentication or rate-limiting requirements, if applicable.

Do not document planned endpoints as if they already work.

### `security.md`

Describe the security controls, especially:

-   SSRF protection for user-provided feed URLs.
-   DNS resolution and IP-range validation.
-   Redirect validation.
-   Request timeouts and response-size limits.
-   Safe XML parsing and feed-content rendering.
-   Secret management and safe logging.
-   Security testing and vulnerability reporting.

### `privacy.md`

Explain what data is stored locally, what data is sent to the backend,
what is synchronized, and what is retained by any server component. Be
specific and avoid claims such as "fully private" unless the
implementation supports them.

### `testing.md`

Describe how to install test dependencies, run unit and integration
tests, run frontend checks, and reproduce important offline and security
tests.

## Screenshots and diagrams

Place approved screenshots and architecture diagrams in `screenshots/`
or another clearly named subfolder. Use descriptive filenames and add
captions or short explanations. Do not include real user reading
histories, private feed URLs, access tokens, or other sensitive
information in screenshots.

## Documentation standards

-   Keep instructions aligned with the current code.
-   Use relative links between repository documents.
-   Clearly label features that are planned, experimental, or
    implemented.
-   Include tested software versions and commands.
-   Prefer short examples that can be copied and run.
-   Update documentation in the same pull request as the code change.
-   Never publish secrets, personal data, or production logs.

## Project-level documentation

The root `README.md` should remain the main entry point for visitors. It
should summarize the project, provide installation instructions, link to
the frontend and backend READMEs, and point to the detailed documents in
this folder.

## Status

This file describes the recommended documentation structure. It does not
imply that every listed document or feature already exists. Add links as
the corresponding files are created and verified.
