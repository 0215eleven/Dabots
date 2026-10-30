# Tunnel review fixes implementation plan

> **For agentic workers:** Use systematic debugging and test-driven development for runtime fixes; independent license and presentation cleanup can run in parallel.

**Goal:** Resolve the six verified review items without changing existing routes, tokens, identities, or mobile behavior.

**Architecture:** Retain the current named-tunnel supervisor and configuration format. Pass the configured token through an isolated child environment, distinguish authentication failures from transient failures, and reset the consecutive restart budget after registration. Preserve process ownership during termination.

**Tech Stack:** Node.js 24, node:test, npm, esbuild.

**Spec:** The user's six review items and authorization in this conversation.

## Global constraints

- Work in the existing checkout; preserve unrelated changes and original notices.
- No live Cloudflare calls, user-profile access, mobile packaging, release, or configuration migration.
- Edit source/generators and rebuild generated clients; never hand-edit bundles.

## Review focus

- Inherited credentials must not override the configured child token or enter status/errors.
- Ordinary network failures must remain retryable; only definite authentication failures are terminal.
- Successful registration restores the restart budget; consecutive failures remain bounded.
- Stop and startup timeout must not leave overlapping owned processes.
- Bloub copyright and full MIT terms must reach the actual desktop archive, including compatibility engine inputs.

### Task 1: Named-tunnel safety and lifecycle

Files: `plugin/bridge/src/named-tunnel.mjs`, new `plugin/bridge/test/named-tunnel.test.mjs`, `plugin/bridge/test/remote-connection.test.mjs`.

- [ ] Add regression tests for argv/environment, authentication versus transient failures, successful-registration budget reset, termination and restart ownership.
- [ ] Run the new tests and record expected failures before fixing production code.
- [ ] Apply minimal supervisor fixes and remove the mixed-language comment.
- [ ] Cover named-mode save/reload/start/stop/mode-switch and secret-free status through real configuration operations.
- [ ] Run Bridge tests and lint.

### Task 2: Disclosure and generated-code cleanup

Files: `plugin/ui/src/remote-panel.mjs`, Bridge documentation, `plugin/scripts/patch-bloub-brand.mjs`, generated clients.

- [ ] Explain local unencrypted token storage and platform permission limits without changing storage.
- [ ] Remove unreachable avatar code through the generator; preserve rendered behavior and idempotence.
- [ ] Verify the transformation against controlled client input, rebuild clients, and run UI/engine checks.

### Task 3: Bloub license delivery

Files: third-party license notice, `plugin/engine/NOTICE`, `plugin/scripts/pack-suite.mjs`, packaging tests.

- [ ] Preserve the exact installed upstream license and version/source attribution.
- [ ] Include the notice in both the source engine and composed plugin archive.
- [ ] Verify required license content in packaging tests, including compatibility inputs.

### Task 4: Integration and delivery

- [ ] Run repository setup, fixture preparation, full checks, audit, integration, suite and Bridge/UI packed-delivery checks.
- [ ] Review the final diff, commit and push the repair branch; report verification boundaries accurately.
