# Official login and tunnel connection

Goal: owner chooses official login, the desktop initializes its dedicated storage and loopback Bridge, registers its independent computer identity, and shows a QR only when ready. No account, relay address, shared secret or mobile update is required.

Keep exactly two public entrances (official login and tunnel connection), with temporary and own-domain tunnel choices. Preserve saved settings, device sessions, credential identities and Agent grants. Selecting the official service uses no saved private secret.

Implementation order:
1. Add failing pairing lease, official selection and first-use initialization tests.
2. Implement owner-opened two-minute, single-use automatic pairing with scoped cancellation, expiry, replay and concurrency protection. Existing manual pairing remains compatible.
3. Initialize storage through the public DSH configuration directory API and retain explicit legacy homes. Register an owner-only lazy-start operation; install alone remains inert.
4. Simplify UI, guard async close/refresh/mode changes and keep codes unavailable while disconnected.
5. Enforce finite public relay registration, connection and traffic quotas with explicit bans, tests and deployment notes.
6. Verify unchanged mobile SDK E2EE pairing, reconnect, refresh and revoke, browser lifecycle, repository checks, packed install/migration and independent review.

Boundaries: no mobile source, SDK, build configuration or package changes; no production deployment, paid resources, domains or security-group changes. Commit and push main without rewriting others' work or invoking hosted mobile builds.
