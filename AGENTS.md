# AGENTS.md — fancy-passkeys-ui

React surfaces for passkey sign-in and passkey management. `CLAUDE.md` points
here. Read the envelope's `AGENTS.md` too, and `.ai/plans/fancy-passkeys.md`.

## The rule that shapes this repo

**An agent can drive everything around a ceremony and can never complete one —
and that is a feature, stated out loud.**

`navigator.credentials.get()` requires a user gesture and a biometric or PIN.
Both are things only the human at the keyboard has. Any "agent-drivable
passkey login" would be a bypass of the single property that makes a passkey
worth having, so this package does not have one and will not grow one.

What that means concretely:

- An agent **may**: list passkeys, rename one, propose a revoke, start an
  enrollment (which then waits for the human), read support/availability, read
  the error state.
- An agent **may not**: complete `create()` or `get()`. There is no prop, no
  imperative handle, and no bridge tool that does it.
- The sketched `registerPasskeyBridge` in the README exposes `passkey_list`,
  `passkey_rename`, `passkey_revoke`, `passkey_begin_enrollment` — and nothing
  that finishes a ceremony. **That absence is the design.** Do not "complete"
  the bridge by adding one.

## Why there is a React-free `./client` subpath

The browser half of the ceremony — calling `@simplewebauthn/browser`, feature
detection, error normalisation — is needed by every frontend, React or not, and
by both backends. Putting it behind the React entry would force React on a Vue
app and force a browser dependency on anything importing the root for types.

So: `./client` is **pure browser, zero React**, and the React components are
built on top of it. `packaging.test.ts` asserts the built `dist/client.js`
contains no React import. If that test starts failing, something moved into the
wrong entry — that is the bug, not the test.

## What these components owe

They are interactive surfaces, so they owe the full component contract — both
the authoring half and the inhabited half.

1. **Controlled, and serializable.** `value` + `onChange`, one object, always
   the FULL next state. Never emit a slice: a host that has to merge slices to
   know what the surface shows is a host an agent cannot read back from. Every
   field must survive `JSON.parse(JSON.stringify(value))` — which is why
   `createdAt` is an ISO string and not a `Date`.

2. **Stable handles, keyed by credential ID.** `data-fancy-passkey-item` is
   keyed by the credential ID, never by list index — an index-keyed handle
   points at a different passkey after a sort or a revoke, and "revoke the one
   the agent named" silently revokes a different one. Adding a new interactive
   element means adding its handle in the same commit, and asserting it.

3. **JSON-friendly props.** No functions inside data. A passkey an agent can
   emit is a plain object.

4. **Revocation is trust-but-verify.** `pendingMode` stages a revoke for human
   confirmation instead of performing it. Revoking the last passkey is a
   lockout, so the confirmation payload carries `isLastPasskey` — a UI that
   asks "are you sure?" without saying "this is your last one" has not actually
   warned anyone.

5. **A cancelled ceremony is not an error.** `NotAllowedError` means the human
   dismissed the prompt or it timed out. Reporting that as a failure trains
   users to distrust the surface. `normalizeCeremonyError` maps it to
   `cancelled`, and it is the one case `PasskeySignIn` renders quietly.

## Dependencies

- `@simplewebauthn/browser`, `@particle-academy/react-fancy`, `react`,
  `react-dom`, and `tailwindcss` are **peers, never dependencies**, and all are
  in `external` in `tsup.config.ts`.
- `dependencies` is **empty and stays empty**. `packaging.test.ts` asserts it.
- Sibling first-party deps use `>=X <2.0` (or `>=4.9.0 <5.0.0` for a `4.x`
  sibling), never a caret on a `0.x`. `devDependencies` keep their carets.

## Commands

```bash
npm install
npm test       # vitest (jsdom for the component tests)
npm run lint   # tsc --noEmit && eslint .
npm run build  # tsup
```

## Conventions

- **Tests render against a real document** (jsdom) and read the DOM back. A
  mock that agrees with whatever we rendered proves nothing.
- **Handles are asserted in tests.** They are the agent-facing API; if they
  move, every agent that learned this surface breaks silently — it finds
  nothing and reports nothing.
- The WebAuthn API is stubbed in tests, never called for real. There is no
  authenticator in CI, and a test that needs one is a test that never runs.
- `CHANGELOG.md` is updated in the SAME commit as the change.
