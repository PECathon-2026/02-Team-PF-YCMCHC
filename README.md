# 53-Team-PF-YCMCHC
Commonplace — Web Feed Discovery Platform

Overview

Commonplace is a web application designed to simplify web feed discovery through a unified interface. It uses a Flask-based backend and API gateway to process requests, validate URLs, and support feed discovery. The project also incorporates service worker caching for application resources and automated integration testing for API reliability and security.

Problem Statement

Problem Statement 3

Commonplace aims to simplify the process of discovering web feeds from websites, providing users with a centralized and accessible way to work with feed-related functionality.

Key Features

- Feed Discovery: Supports discovering feed URLs from user-provided website URLs.
- REST API: Provides backend endpoints for handling feed-related requests.
- Input Validation: Handles missing parameters and invalid requests with appropriate HTTP status codes.
- URL Security: Includes protections against requests to private and loopback network destinations to mitigate Server-Side Request Forgery (SSRF).
- Offline Support: Uses a service worker to cache selected application resources.
- Automated Testing: Includes integration tests for API responses, parameter validation, and URL security checks.

Technology Stack

- Backend: Python, Flask
- API Communication: HTTP and JSON
- Testing: Python unittest
- Offline Functionality: JavaScript Service Worker
- Version Control: Git and GitHub

System Architecture

Commonplace follows a client-server architecture.

1. Frontend: Provides the interface for user interaction.
2. Flask Backend: Processes incoming requests and executes application logic.
3. Feed Discovery Module: Handles feed URL discovery.
4. URL Validation and Security: Validates URLs and blocks prohibited destinations.
5. Service Worker: Caches selected application resources for offline access.
6. Testing Module: Verifies API behavior and selected security requirements.

Architecture Flow

User
  |
  v
Web Application
  |
  v
Flask Backend / API Gateway
  |
  +-------------------+
  |                   |
  v                   v
Feed Discovery    URL Validation
  |                   |
  +---------+---------+
            |
            v
      JSON Response
            |
            v
      Web Application

API Overview

Method| Endpoint| Description
GET| "/api/autodiscover"| Discovers a feed using a supplied website URL.

Request Parameter

- "url": The website URL for which feed discovery is requested.

Error Handling

- 400 Bad Request: Returned when the required URL parameter is missing.
- 403 Forbidden: Returned when a request targets a prohibited private or loopback destination, as covered by the integration tests.

Security

Security is an important consideration in Commonplace.

The application includes URL validation and SSRF-related protections intended to prevent unauthorized requests to private network destinations.

Security considerations include:

- Validating user-provided URLs.
- Blocking prohibited private and loopback destinations.
- Handling invalid requests safely.
- Avoiding exposure of sensitive configuration and internal errors.
- Preventing unintended caching of dynamic API responses.

Testing

The project includes integration tests for the Flask web server and API gateway.

The tests cover:

- API response validation.
- Missing URL parameter handling.
- Blocking requests to private or loopback destinations.

Tests can be executed using Python's unittest framework when the project dependencies and test configuration are installed.

Offline Support

Commonplace includes a service worker designed to cache selected application-shell resources. Dynamic API routes, including "/api/fetch" and "/api/discovery", are intended to remain excluded from runtime caching.

Offline functionality depends on the resources cached by the application and does not necessarily provide offline feed discovery.

Future Scope

- Improve feed discovery accuracy and reliability.
- Enhance the user interface and user experience.
- Expand automated testing and security validation.
- Improve offline functionality and application performance.
- Introduce additional feed management capabilities.

Team

Project Name: Commonplace
Problem Statement: 3

Acknowledgements

We thank the hackathon organizers, mentors, and contributors for their guidance and support during the development of this project.

License

The project is developed as part of a hackathon initiative. Licensing and attribution are subject to the project's selected license and applicable third-party requirements.



