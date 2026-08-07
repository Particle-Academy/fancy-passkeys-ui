# Changelog

All notable changes to `@particle-academy/fancy-passkeys-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0.** Breaking changes land in MINOR releases until 1.0.0. The version
> number is not yet a compatibility promise, so read this file before upgrading
> a minor.

## [Unreleased]

## 0.2.0 — 2026-08-07

### Changed

- **BREAKING — Node 22 is now declared as the floor.** `engines.node` is `>=22`, where this package previously declared **nothing at all**.

  Declaring nothing was not the same as supporting old Node: a consumer on 18 installed cleanly and found out at runtime.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

- **BREAKING — React 18 is no longer supported.** `peerDependencies.react` / `react-dom` are now `^19.0.0`.

  **What you must do:** on React 19, nothing. On React 18, stay on the previous release, or upgrade your app to 19 first.

  React 18 support was a claim nothing tested — every build and test in this package ran against 19, so the 18 half of the old range was never executed. An untested compatibility claim is worse than an absent one, because it reads as support.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.


## 0.1.0 — 2026-08-01

**First published release.** Passkey sign-in and passkey management, plus a React-free `/client` subpath for the browser ceremony. Its MCP bridge is **management-only by design** — no tool completes a ceremony, because a gesture plus biometric is something only the human has.

### Added

- Initial implementation. **Not published** — no npm release and no tag exists
  for this yet.
- `./client` — a **React-free** subpath carrying the browser half of both
  ceremonies: `registerPasskey`, `authenticateWithPasskey`,
  `isPasskeySupported`, `isPlatformAuthenticatorAvailable`,
  `isConditionalUiAvailable`, and `normalizeCeremonyError`. Works against
  either backend, from any frontend, with no React in the tree.
- `PasskeyTransport` — a one-method (`post(path, body?)`) seam, so an app with
  its own fetch wrapper, auth headers or retry policy implements it in four
  lines instead of configuring ours.
- `createFetchTransport()` — the batteries-included transport: `POST`, JSON,
  `credentials: "same-origin"`, and Laravel's CSRF header (explicit token, or
  the `XSRF-TOKEN` cookie when none is given).
- `PasskeyCeremonyError` and `PasskeyServerError` — every rejection from
  `./client` is typed. A backend's own `PasskeyErrorCode` survives on
  `serverCode` instead of being flattened to `ceremony_failed`.
  Note that the first-party backends redact `unknown_credential`,
  `user_handle_mismatch` and `counter_regressed` to `verification_failed`
  before they reach the wire, so do not branch on those three — see the
  README's Human+ section.
- `authenticateWithPasskey` accepts an `AbortSignal`, wired to
  `WebAuthnAbortService.cancelCeremony()` so tearing down a conditional-UI
  request actually closes the browser prompt rather than walking away from it.
  An abort settles as `cancelled`, never as a failure.
- `PasskeyManager` rename is staged through `renamingId` + `draftName`, with
  `save-rename` / `cancel-rename` handles alongside the revoke ones.
- `tailwindcss` added to `external` in `tsup.config.ts` so all five peers are
  externalised, and `packaging.test.ts` asserts it.
- `PasskeySignIn` — a controlled sign-in surface. Discoverable (usernameless)
  by default; `mode="email"` for the username-first flow.
- `PasskeyManager` — a controlled list of a user's passkeys with rename and
  revoke.
- `PasskeyStatus` — a purely visual support/availability indicator.
- Both interactive surfaces satisfy the Human+ component contract: controlled
  `value` + `onChange` emitting the full next state, stable
  `data-fancy-passkey-*` handles keyed by credential ID, JSON-serializable
  props, `onActivity` events, and `pendingMode` on revoke.

### Security

- **No agent can complete a ceremony, by construction.** The surfaces expose
  state and intent; `navigator.credentials.get()` needs a user gesture and a
  biometric, and neither is something a bridge can supply. The MCP bridge
  (`registerPasskeyBridge`, shipped in `@particle-academy/agent-integrations`
  ≥ 0.34.0) has no ceremony-completing tool — that absence is the design, not an
  omission, and a test there asserts the tool names against a closed list so it
  cannot be "finished" into existence.
- Revoking a passkey is `pendingMode`-capable, and the last remaining passkey
  is flagged as a lockout in the confirmation payload rather than being
  silently revoked.
- Ceremony errors are normalised so a cancelled prompt (`NotAllowedError`)
  reads as "cancelled", not "failed" — a login surface that reports abandonment
  as an error trains users to distrust it.
- A regressed signature counter (`clonedAt`) is rendered as an announced alert
  on the credential's own row, not as a line of metadata. It means the private
  key may exist on more than one device, which is a security event.

### Notes

- **Tailwind needs an `@source` line for react-fancy's dist, and the README now
  says so.** Tailwind v4 does not scan `node_modules`; without it the surfaces
  mount and behave perfectly and render completely unstyled — which is exactly
  what the first browser render of this package produced. This package's own
  classes ship in its stylesheet and need no `@source`.
- **No `listPasskeys()` in `./client`.** The wire contract defines four
  endpoints and all four are ceremony endpoints. Listing, renaming and revoking
  are ordinary CRUD over the app's own model, so `PasskeyManager` is fully
  controlled and the host wires it — rather than this package inventing a fifth
  endpoint neither backend serves.
- `npm test` runs `tsup` first (`pretest`). The packaging test asserts against
  the **built** `dist/client.js`, and a packaging test that skips when the build
  is missing is a packaging test that never runs in the one situation it exists
  for.
