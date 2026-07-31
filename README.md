# @particle-academy/fancy-passkeys-ui

React surfaces for **passkey (WebAuthn) sign-in and passkey management**, plus a
**React-free browser-ceremony subpath** that works from any frontend.

Part of the Fancy passkeys trio. The two backends are byte-identical on the
wire, so the same React surface works against either one:

| Package | Runtime | Role |
|---|---|---|
| `particle-academy/fancy-passkeys` (Composer) | PHP / Laravel | Server. Wraps `web-auth/webauthn-lib`. |
| `@particle-academy/fancy-passkeys` (npm) | Node | Server twin. Wraps `@simplewebauthn/server`. |
| **`@particle-academy/fancy-passkeys-ui`** (npm) | Browser | **This package.** React surfaces + `./client`. |

> **Pre-1.0, and not yet published.** Breaking changes land in MINOR releases
> until 1.0.0. Read `CHANGELOG.md` before upgrading a minor.

---

## Install

```bash
npm install @particle-academy/fancy-passkeys-ui
```

**Everything is a peer** — this package has an empty `dependencies` and keeps it
that way. Install what you actually use:

```bash
# Always
npm install @simplewebauthn/browser

# Only if you use the React surfaces (skip these for `./client`-only usage)
npm install react react-dom @particle-academy/react-fancy tailwindcss
```

Why peers: a host may already have `@simplewebauthn/browser`, and a second copy
in the tree is how you end up with two incompatible credential types or a
resolver quietly choosing an older version. Both look exactly like success.

Import the stylesheet once, anywhere in your app:

```ts
import "@particle-academy/fancy-passkeys-ui/styles.css";
```

---

## Quickstart

The components never call `navigator.credentials` themselves. They render state
and emit intent; the host runs the ceremony with `./client`. That split is what
makes them testable without an authenticator — and what keeps the ceremony
firmly in the hands of the human at the keyboard.

### Sign in

```tsx
import { useState } from "react";
import {
  PasskeySignIn,
  authenticateWithPasskey,
  createFetchTransport,
  isPasskeySupported,
  type PasskeySignInState,
} from "@particle-academy/fancy-passkeys-ui";

const transport = createFetchTransport({ baseUrl: "/passkeys" });

export function Login() {
  const [state, setState] = useState<PasskeySignInState>({
    status: isPasskeySupported() ? "idle" : "unsupported",
    email: "",
    error: null,
  });

  return (
    <PasskeySignIn
      value={state}
      onChange={setState}
      onAuthenticate={async () => {
        // Throwing signals failure; resolving signals success. The component
        // maps a dismissed prompt to `status: "cancelled"` for you.
        const { user } = await authenticateWithPasskey(transport);
        console.log("signed in as", user);
        window.location.href = "/dashboard";
      }}
    />
  );
}
```

`mode="discoverable"` is the default: **one button, no username field.** That is
the usernameless flow the plan optimises for, and the one with nothing to
enumerate. For the username-first flow:

```tsx
<PasskeySignIn
  mode="email"
  conditional            // opt into autofill; adds `autocomplete="username webauthn"`
  value={state}
  onChange={setState}
  onAuthenticate={({ email }) => authenticateWithPasskey(transport, { email, conditional: true })}
/>
```

Check `isConditionalUiAvailable()` before setting `conditional` — not every
browser offers passkeys from inside a field, and claiming autofill where there
is none just leaves an inert input.

### Manage passkeys

```tsx
import { useState } from "react";
import {
  PasskeyManager,
  registerPasskey,
  createFetchTransport,
  type PasskeyManagerState,
  type PasskeySummary,
} from "@particle-academy/fancy-passkeys-ui";

const transport = createFetchTransport();

export function PasskeySettings({ passkeys }: { passkeys: PasskeySummary[] }) {
  const [state, setState] = useState<PasskeyManagerState>({
    passkeys,
    pendingRevoke: null,
    renamingId: null,
    draftName: "",
    status: "idle",
    error: null,
  });

  return (
    <PasskeyManager
      value={state}
      onChange={setState}
      onEnroll={async () => {
        const { credential } = await registerPasskey(transport, { name: "This device" });
        setState((prev) => ({ ...prev, passkeys: [...prev.passkeys, credential] }));
      }}
      onRename={({ id, name }) => fetch(`/passkeys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })}
      onRevoke={({ id }) => fetch(`/passkeys/${id}`, { method: "DELETE" })}
    />
  );
}
```

**`pendingMode` defaults to `true`.** Pressing *Revoke* stages the revocation
and renders a confirmation; only an explicit confirm calls `onRevoke`. When it
is the account's **last** passkey, `pendingRevoke.isLastPasskey` is `true` and
the confirmation says so in as many words — a dialog that asks "are you sure?"
without naming the lockout has not warned anyone.

> **Listing, renaming and revoking are your app's routes, not ours.** The wire
> contract defines exactly four endpoints, all of them ceremony endpoints
> (§6 of the plan). Passkey *management* is ordinary CRUD over your own model,
> so `PasskeyManager` is fully controlled and you wire it to whatever you
> already have — Inertia props, a REST route, a GraphQL field. There is
> deliberately no `listPasskeys()` in `./client` inventing a fifth endpoint that
> neither backend serves.

### Support indicator

```tsx
import { useEffect, useState } from "react";
import {
  PasskeyStatus,
  isPasskeySupported,
  isPlatformAuthenticatorAvailable,
  isConditionalUiAvailable,
} from "@particle-academy/fancy-passkeys-ui";

export function Support() {
  const [platform, setPlatform] = useState<boolean | null>(null);
  const [autofill, setAutofill] = useState<boolean | null>(null);

  useEffect(() => {
    void isPlatformAuthenticatorAvailable().then(setPlatform);
    void isConditionalUiAvailable().then(setAutofill);
  }, []);

  return (
    <PasskeyStatus
      supported={isPasskeySupported()}
      platformAuthenticator={platform}
      conditionalUi={autofill}
    />
  );
}
```

`PasskeyStatus` runs no detection of its own on purpose: probing inside a
component makes it non-deterministic under SSR and in tests, and the host
already has the three predicates.

---

## Without React — `./client`

The browser half of both ceremonies ships on its own entry point with **zero
React**. A Vue, Svelte, Alpine or vanilla frontend imports this and nothing
else; React never enters the dependency tree, and
[`tests/packaging.test.ts`](./tests/packaging.test.ts) asserts the built
`dist/client.js` contains no React import.

```ts
import {
  createFetchTransport,
  registerPasskey,
  authenticateWithPasskey,
  normalizeCeremonyError,
  isPasskeySupported,
} from "@particle-academy/fancy-passkeys-ui/client";

const transport = createFetchTransport({ baseUrl: "/passkeys" });

document.querySelector("#sign-in")!.addEventListener("click", async () => {
  try {
    const { user } = await authenticateWithPasskey(transport);
    location.assign("/dashboard");
  } catch (err) {
    const failure = normalizeCeremonyError(err);
    if (failure.code === "cancelled") return;      // not an error — see below
    showError(failure.serverCode ?? failure.code, failure.message);
  }
});
```

### The wire contract it drives

Both backends implement this identically, which is the whole point of shipping a
matched pair:

```
POST {prefix}/register/options    → { state, publicKey }
POST {prefix}/register             { state, name?, response }  → { credential }
POST {prefix}/login/options        { email? }                  → { state, publicKey }
POST {prefix}/login                { state, response }         → { user, credential }

errors → 4xx  { "error": { "code": PasskeyErrorCode, "message": string } }
```

`state` is an opaque handle to the server-side challenge record. It is
round-tripped untouched. The server pulls (reads **and deletes**) that record
before it verifies anything, so a replayed response fails at "no such challenge"
whether or not its signature is valid.

### Transports

`createFetchTransport()` covers the common case: `POST`, JSON in and out,
`credentials: "same-origin"`, and Laravel's CSRF header. Pass `csrfToken` (a
string or a getter) when your app issues one; otherwise the transport reads the
`XSRF-TOKEN` cookie, which is what a Laravel app already sets.

Anything with a `post(path, body?)` method works, so an app with its own fetch
wrapper — retries, auth headers, tracing — implements `PasskeyTransport` in four
lines instead of configuring ours. Reject on a non-2xx, ideally with a
`PasskeyServerError` so the backend's own error code survives.

### Errors: a cancelled ceremony is not a failure

`normalizeCeremonyError()` turns everything a ceremony can throw into a typed
`PasskeyCeremonyError`:

| Thrown | `code` |
|---|---|
| `NotAllowedError` | `cancelled` — the human dismissed the prompt, or it timed out |
| `AbortError` | `cancelled` — the host tore the ceremony down |
| `InvalidStateError` | `already_registered` |
| `SecurityError` | `security_error` |
| `NotSupportedError` | `not_supported` |
| anything else | `ceremony_failed` |

The first row is load-bearing. The browser reports "the user closed the dialog"
with the same error it uses for a genuine refusal, and a login surface that
paints abandonment red teaches people the surface is broken. `PasskeySignIn`
renders `status: "cancelled"` as a muted hint and nothing louder.

A 4xx from either backend becomes a `PasskeyServerError` — a subclass, so
`instanceof PasskeyCeremonyError` still catches it — carrying the server's own
code verbatim on `serverCode`. That code is never flattened into
`ceremony_failed`: a backend saying `counter_regressed` is telling you a
credential may have been cloned, and losing that in normalisation loses the one
signal the counter exists to produce.

---

## Human+ contract

These are interactive surfaces, so they owe both halves of the suite's component
contract: a good **authoring** surface *and* an **inhabited** one, where agents
are first-class participants rather than external things scraping the DOM.

- **Controlled and serializable.** `value` + `onChange`, always the **full** next
  state, never a slice. Every field survives
  `JSON.parse(JSON.stringify(value))` — which is why `createdAt` is an ISO
  string and not a `Date`.
- **Stable handles, keyed by credential ID.**
  `data-fancy-passkey-surface="<surfaceId>"` on the root,
  `data-fancy-passkey-item="<credential id>"` on every row, and
  `data-fancy-passkey-action="rename|save-rename|cancel-rename|revoke|confirm-revoke|cancel-revoke|enroll|authenticate"`
  on every button, each carrying `data-fancy-passkey-id`. **Never an index** — an
  index-keyed handle points at a different credential after a sort or a revoke,
  so "revoke the one the agent named" silently revokes somebody else's laptop
  and nothing reports it.
- **Trust-but-verify.** `pendingMode` (default `true`) stages a revoke for human
  confirmation, and flags the last-passkey lockout explicitly.
- **Observable.** `onActivity` emits an `AgentActivity`-shaped event on every
  mutation — `authenticate`, `enroll`, `rename`, `revoke-proposed`,
  `revoke-confirmed`, `revoke-cancelled`, `cancelled`, `error` — so presence,
  undo and coaching layers compose for free.

### What an agent can and cannot do

**An agent can drive everything around a ceremony, and can never complete one.
That is a feature, and it is stated out loud.**

An agent **may**: list passkeys, rename one, propose a revoke, start an
enrollment (which then waits for the human), read support and availability, read
the error state.

An agent **may not**: complete `navigator.credentials.create()` or `.get()`.
There is no prop, no imperative handle, no exported function and no bridge tool
that does it — and there will not be one.

The reason is not policy, it is construction. A passkey ceremony requires a user
gesture and a biometric or PIN, and both of those are things only the person at
the keyboard has. An "agent-drivable passkey login" would be a bypass of the
exact property that makes a passkey worth having over a password: that
possession of the credential cannot be delegated, replayed, or phished. A
package that offered one would be quietly turning a phishing-resistant factor
back into a bearer token.

So the boundary is drawn where the cryptography already draws it, and the
package is honest about which side of it each affordance lives on.

### Sketch: `registerPasskeyBridge` — **not shipped in v1**

The MCP bridge below is a **sketch**, not code in this package. It is here so the
shape is on the record — and so the *absence* in it is legible as a decision
rather than an oversight.

```ts
// SKETCH — NOT SHIPPED IN v1. Illustrative only.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PasskeySummary } from "@particle-academy/fancy-passkeys-ui/client";

export interface PasskeyBridgeAdapter {
  list(): Promise<PasskeySummary[]>;
  rename(input: { id: string; name: string }): Promise<void>;
  /** Stages a revoke for human confirmation. Never revokes outright. */
  proposeRevoke(input: { id: string }): Promise<{ staged: true; isLastPasskey: boolean }>;
  /** Opens the enrollment prompt on the human's screen and returns immediately. */
  beginEnrollment(input?: { name?: string }): Promise<{ awaitingHuman: true }>;
}

export function registerPasskeyBridge(
  server: McpServer,
  { adapter }: { adapter: PasskeyBridgeAdapter },
): void {
  server.tool("passkey_list", "List the signed-in user's passkeys.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(await adapter.list()) }],
  }));

  server.tool("passkey_rename", "Rename one passkey, by credential ID.", RenameSchema, /* … */);

  // Proposes only. The human confirms in the UI — revoking the last passkey is
  // a lockout, which is exactly the destructive action a staged write exists for.
  server.tool("passkey_revoke", "Propose revoking one passkey.", RevokeSchema, /* … */);

  // Opens the prompt. The ceremony completes on the human's authenticator or it
  // does not complete at all.
  server.tool("passkey_begin_enrollment", "Start enrolling a passkey.", EnrollSchema, /* … */);

  // ── There is deliberately NO tool here that completes a ceremony. ──────────
  // No `passkey_authenticate`, no `passkey_sign_in`, no `passkey_complete`.
  // That absence IS the design. Do not "finish" this bridge by adding one.
}
```

---

## API

### `./client` (React-free)

| Export | |
|---|---|
| `createFetchTransport(options?)` | `fetch`-based `PasskeyTransport` with CSRF + same-origin cookies |
| `registerPasskey(transport, { name? })` | Enroll a passkey for the authenticated user |
| `authenticateWithPasskey(transport, { email?, conditional?, signal? })` | Sign in |
| `normalizeCeremonyError(err)` | Anything → typed `PasskeyCeremonyError` |
| `isPasskeySupported()` | Sync feature detection |
| `isPlatformAuthenticatorAvailable()` | Touch ID / Windows Hello present? |
| `isConditionalUiAvailable()` | Can the browser offer passkeys from a field? |
| `PasskeyCeremonyError`, `PasskeyServerError` | The two error classes |
| `PasskeyTransport`, `PasskeySummary`, … | Types |

### Root (React) — everything above, plus

| Export | |
|---|---|
| `PasskeySignIn` | Controlled sign-in surface (discoverable or username-first) |
| `PasskeyManager` | Controlled list + rename + revoke, `pendingMode` by default |
| `PasskeyStatus` | Purely visual support/availability indicator |
| `PasskeyActivityEvent` | The `onActivity` payload |

---

## Development

```bash
npm install
npm test       # vitest — builds first (`pretest`) so the packaging assertions are real
npm run lint   # tsc --noEmit && eslint .
npm run build  # tsup
```

Tests render against a real document (jsdom) and read the DOM back; a mock that
agrees with whatever we rendered proves nothing. The WebAuthn API is stubbed and
never called for real — there is no authenticator in CI, and a test that needs
one is a test that never runs.

## License

MIT
