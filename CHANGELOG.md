# Changelog

All notable changes to `@particle-academy/fancy-passkeys-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0.** Breaking changes land in MINOR releases until 1.0.0. The version
> number is not yet a compatibility promise, so read this file before upgrading
> a minor.

## [Unreleased]

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
  `serverCode` instead of being flattened to `ceremony_failed`; a server saying
  `counter_regressed` is reporting a possible clone, and normalising that away
  loses the one signal the signature counter exists to produce.
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
  biometric, and neither is something a bridge can supply. The sketched MCP
  bridge deliberately has no ceremony-completing tool — that absence is the
  design, not an omission.
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

- **No `listPasskeys()` in `./client`.** The wire contract defines four
  endpoints and all four are ceremony endpoints. Listing, renaming and revoking
  are ordinary CRUD over the app's own model, so `PasskeyManager` is fully
  controlled and the host wires it — rather than this package inventing a fifth
  endpoint neither backend serves.
- `npm test` runs `tsup` first (`pretest`). The packaging test asserts against
  the **built** `dist/client.js`, and a packaging test that skips when the build
  is missing is a packaging test that never runs in the one situation it exists
  for.
