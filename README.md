# @particle-academy/fancy-passkeys-ui

[![Fancified](art/fancified.svg)](https://particle.academy)

React surfaces for **passkey (WebAuthn) sign-in and passkey management**, plus a
**React-free browser-ceremony subpath** that works from any frontend.

Part of the Fancy passkeys trio. The two backends are byte-identical on the
wire, so the same React surface works against either one:

| Package | Runtime | Role |
|---|---|---|
| `particle-academy/fancy-passkeys` (Composer) | PHP / Laravel | Server. Wraps `web-auth/webauthn-lib`. |
| `@particle-academy/fancy-passkeys` (npm) | Node | Server twin. Wraps `@simplewebauthn/server`. |
| **`@particle-academy/fancy-passkeys-ui`** (npm) | Browser | **This package.** React surfaces + `./client`. |

> **Pre-1.0.** Breaking changes land in MINOR releases
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

**If you use the React surfaces, point Tailwind at react-fancy's dist too.**
Tailwind v4 does not scan `node_modules`, and these surfaces render react-fancy's
`Button` / `Badge` / `Callout` / `Input` — so without this line everything mounts,
behaves, and comes out completely unstyled:

```css
/* your app.css, beside `@import "tailwindcss";` */
@source '../node_modules/@particle-academy/react-fancy/dist/**/*.{js,cjs,mjs}';
```

This package's own classes ship in its stylesheet, so it needs no `@source` of
its own.

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
`ceremony_failed`; whatever a backend said, you get to read it.

**What the first-party backends actually send.** Both deliberately redact three
codes to `verification_failed` on the wire — `unknown_credential`,
`user_handle_mismatch`, and `counter_regressed` — because each one answers a
question about a credential the server holds ("is this registered here?",
"whose is it?", "do you think it was cloned?") for an unauthenticated caller.
They remain precise in the server's own logs and events.

So do **not** build UI that branches on those three: against
`particle-academy/fancy-passkeys` or `@particle-academy/fancy-passkeys` they
will never arrive. A clone detection reaches the user through the app's own
notification path, after the app has identified them — not through a login
error a stranger can read. `serverCode` still exists for the other codes, and
for a custom backend that chooses to send more.

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

### The MCP bridge: `registerPasskeyBridge`

The bridge ships in **`@particle-academy/agent-integrations` ≥ 0.34.0**, not in
this package — bridges live with the MCP layer, so a consumer who wants the
surfaces without an agent installs nothing extra.

```bash
npm install @particle-academy/agent-integrations
```

```tsx
import { ToolRegistry } from "@particle-academy/agent-integrations/mcp";
import { registerPasskeyBridge } from "@particle-academy/agent-integrations/bridges/passkeys";

const bridge = registerPasskeyBridge(host, {
  adapter: {
    // The same callbacks you already handed <PasskeyManager />.
    list: () => passkeys,
    rename: ({ id, name }) => api.rename(id, name),
    // STAGES it — sets `pendingRevoke`, which renders the confirm dialog.
    // Wiring this to a delete call removes the human from the loop the whole
    // bridge is built around.
    proposeRevoke: ({ id }) =>
      setState((s) => ({ ...s, pendingRevoke: { id, isLastPasskey: s.passkeys.length <= 1 } })) ?? {
        staged: true,
        isLastPasskey: passkeys.length <= 1,
      },
    beginEnrollment: () => startEnrollment(),
    support: () => ({ supported: isPasskeySupported() }),
    state: () => ({ status: state.status, error: state.error, pendingRevoke: state.pendingRevoke }),
  },
});
```

| Tool | |
|---|---|
| `passkey_list` | The user's credentials, re-projected onto the public summary fields — a public key or user handle on your record never reaches the agent |
| `passkey_status` | Browser support + what the surface is showing, and `canCompleteCeremony: false` said out loud |
| `passkey_rename` | Relabel by credential ID. Immediate, undoable with `agent_undo`; `confirmRename: true` gates it behind a host hook |
| `passkey_revoke` | **Stages** a revoke for the human. Never revokes; there is no `confirm` argument, and the schema rejects one |
| `passkey_begin_enrollment` | Opens the prompt and returns. The ceremony finishes on the human's authenticator |

There is deliberately **no** tool that completes a ceremony — no
`passkey_authenticate`, no `passkey_sign_in`, no `passkey_complete`. That absence
IS the design, and agent-integrations pins it with a test that asserts the
registered tool names against a closed list, so "finishing" the bridge fails CI
rather than shipping.

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
