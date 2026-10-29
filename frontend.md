# Commonplace Frontend

The frontend is the user-facing part of **Commonplace**, a
privacy-first, offline-first reader for RSS and Atom feeds. It provides
the reading interface, subscription management, saved articles, and
discovery experience.

## Responsibilities

-   Display the application dashboard and subscribed feeds.
-   Let readers browse feed entries and open article details.
-   Provide subscription, search, bookmark, and reading-history
    interactions as implemented.
-   Communicate with the Flask backend through documented API endpoints.
-   Support responsive layouts and accessible keyboard navigation.
-   Provide an offline-capable application shell through the service
    worker.

## Suggested structure

``` text
frontend/
├── index.html
├── src/
│   ├── components/       # Reusable UI components
│   ├── scripts/          # Application logic and API client
│   └── styles/           # CSS, themes, and responsive styles
└── static/
    ├── manifest.json
    └── icons/
```

Adapt this tree to the actual files in your project. Do not create empty
placeholder files merely to match the example.

## Requirements

-   A modern browser with JavaScript enabled.
-   The backend running locally or at the configured API base URL.
-   Any frontend build tools or packages listed by the project (if
    applicable).

## Run locally

If the frontend is served by Flask, start the backend using the
instructions in `../backend/README.md` and open the local application
URL shown in the terminal.

If the frontend is a separate static application, serve the frontend
directory with your chosen development server. For a simple Python
static server:

``` bash
cd frontend
python -m http.server 5500
```

Then visit `http://localhost:5500`. Configure the API base URL to point
to the backend, and ensure CORS is configured only for trusted
development origins when separate origins are used.

## API integration

Keep API calls in a shared client/helper rather than scattering fetch
logic across UI components. Handle:

-   Loading, empty, and error states.
-   Invalid feed URLs and unavailable feeds.
-   Network timeouts and offline conditions.
-   Server error responses without exposing internal details.
-   Safe rendering of feed titles, descriptions, and article content.

See `../docs/README.md` for the API documentation location and expected
documentation.

## Offline behaviour

The service worker should cache only the application shell and
explicitly approved static assets. **Do not runtime-cache `/api/fetch`
or `/api/discovery`**. Do not cache private or user-specific responses
unless the product's privacy design explicitly permits it and the
implementation has been reviewed.

When changing the shell asset list, verify that every path exists. When
changing the cache version, update the single cache-name declaration and
test an upgrade from the previous version.

## Security and privacy

-   Treat feed content as untrusted input; render it safely.
-   Do not insert feed HTML directly into the page without sanitization.
-   Do not put secrets or private user data in frontend source code.
-   Avoid logging private feed URLs or reading activity.
-   Use HTTPS in production.
-   Keep browser storage behaviour clear to users and document what is
    stored locally.

## Testing checklist

-   [ ] Dashboard and navigation render at desktop and mobile sizes.
-   [ ] Feed loading, empty feeds, and API failures are handled.
-   [ ] Invalid URLs display a helpful error.
-   [ ] Keyboard focus and accessible labels are present.
-   [ ] Offline application shell works after the first successful
    visit.
-   [ ] Service worker does not cache `/api/fetch` or `/api/discovery`.
-   [ ] Feed content cannot inject executable scripts into the
    interface.

## Notes for contributors

Before submitting changes, test the frontend with the backend version in
the repository, update screenshots if the UI changes, and describe any
new configuration variables. This README is a starting template; update
commands and paths to match the actual implementation.
