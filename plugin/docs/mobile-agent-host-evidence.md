# Mobile Agent host boundary evidence

Reviewed on 2026-10-23 against the isolated fixtures produced by
`npm --prefix bridge run test:prepare`. This review found no documented guarantee
in the inspected pinned APIs that arbitrary Agent transcript text is safe to
release after global provider and connector secrets have been removed. This is a
limit of the inspected version and contract, not a claim about future DSH versions.
Mobile Agent creation and chat therefore remain disabled.

## Reproducible sources

The fixture preparation script pins public npm `ds-bot@0.1.7`, verifies its tarball
integrity, and applies the repository's reviewed group patch to a separate copy.
The unmodified package is `bridge/fixture/vanilla/package/`; its manifest declares
Apache-2.0 and the source repository `Fei2411/DeepSeek-Bot`, directory `ds-bot`.
The integrity is:

```text
sha512-xRiXIpDfemkZ2l6lDwu7ZKSnn0a2c26BsZ7e+eEOkQ1AknXOKretK52Yuq1yfG6p4XCObmUiXR1tdGo7EQIStw==
```

All DSH packages below were checked in this task's
`bridge/fixture/deps/node_modules/@deepseek-ai/`. Each manifest declares version
`0.2.1-rc.2`, MIT, and source repository `deepseek-ai/deepseek-harness`.
The paths in the evidence table are relative to the named package.

| Public npm package | Source repository directory | Evidence in the pinned package |
| --- | --- | --- |
| `@deepseek-ai/dsh` | `apps/cli` | `package.json`: fixture engine version; no installed user engine was inspected |
| `@deepseek-ai/dsh-api-session-controller` | `packages/api/session-controller` | `lib/types/index.d.ts:171,196,204`: prompt, page and follow; `lib/types/types.d.ts:449,535,543`: history carries Session event records |
| `@deepseek-ai/dsh-credentials` | `packages/credentials/credentials` | `lib/types/index.d.ts:130,159,168,174`: named reference resolution, record reads and record enumeration; the reference space is explicitly not enumerable |
| `@deepseek-ai/dsh-client-ui-secret-mask` | `packages/client/ui-secret-mask` | `README.md:12,45,75`: display masking preserves original message/copy/model text and does not recognize arbitrary assignments or passwords |
| `@deepseek-ai/dsh-session-telemetry` | `packages/session/session-telemetry` | `lib/types/index.d.ts:23-36`: a deployment redaction extension point with no built-in rules; without a listener it passes records through |
| `@deepseek-ai/dsh-settings` | `packages/settings/settings` | `lib/types/redact.d.ts:1-7,29-37`: removes schema-declared secret fields from settings objects; it is not a transcript text sanitizer |

No dependency code is copied into this document or the production packages. The
downloaded fixture packages retain their licenses; see [bridge provenance](../bridge/NOTICE).
The repository's separate `ds-bot/ds-bot/package.json` source snapshot declares
`0.2.0`; that snapshot is not evidence that npm DS Bot 0.2.0 was installed or tested.

## Why the existing redactor is insufficient

In public DS Bot 0.1.7, `src/host/agents.js:1-3,22-25` describes Agent Sessions as
ordinary root Sessions using the global DSH surface except DS Bot's team tools.
`src/host/secrets.js:90-100,544` constructs its known-value redactor from DS Bot's
own secret map. The shipped group patch's `bridge.redact` invokes that redactor
after loading the DS Bot secret store; it provides no global credential coverage.

The DSH credential API offers values for a known reference, but does not enumerate
all references. Its `GrantRecord.payload` is opaque owner-defined JSON
(`dsh-credentials/lib/types/types.d.ts:43-51`). Neither the credential metadata nor
settings structural redaction establishes a complete set of global values to
remove from arbitrary text. Reading every available credential into the Bridge
would also broaden its secret access without establishing that guarantee.

The synthetic counterexample in
[`bridge/test/agent-boundary.test.mjs`](../bridge/test/agent-boundary.test.mjs)
passes an assistant sentence through the existing Bridge formatting filter and
the actual pinned DS Bot redactor. A synthetic DS Bot secret is removed; separate
synthetic provider and connector values remain. This is a characterization of the
missing boundary, not an acceptable transcript or proof of a real credential leak.
Dropping raw tool output does not solve this case because assistant text can echo
the value.

The `shipped DS Bot patch refuses Agent targets for submit and redaction before
admission` case in [`group.test.mjs`](../bridge/test/group.test.mjs) calls the
actual patched channel through the public owner connection. Agent identifiers
and Agent Sessions injected into Bot/Room targets return `bot/stale` for both
endpoints without invoking prompt admission. This proves the existing patch is
closed to those targets; it does not implement an Agent contract.

## Feasible interfaces and remaining work

DS Bot 0.1.7 already contains `addAgent` and `createAgentSession`
(`src/host/agents.js:86,119`). The pinned Session controller documents queued/logged
`requestId` replay returning the existing acceptance (`README.md:34`), and declares
the queue prompt and accepted receipt (`lib/types/types.d.ts:332-344`). These are
useful building blocks, not a completed mobile Agent contract.

Before enabling the feature, a reviewed host contract must supply the required
safe text projection and identify its coverage. Agent-to-Session ownership,
current lifecycle validity, default-workspace creation, lost-response recovery,
and authorization must then be enforced across creation, submit, redaction,
history and stream. Existing paired devices require a separate explicit owner
grant; a new capability flag must not grant them Agent access automatically.

DS Bot's existing approval listener only tracks Bot/group owners and otherwise
delegates to DSH (`src/host/approvals.js:15-19`). Agent support also needs a safe
waiting-for-desktop indicator while preserving DSH's own answerer. It must not
introduce mobile approval bypasses. None of these requirements is satisfied by
the current Bot/Room `bridge.describe` or by the closed-boundary tests alone.
