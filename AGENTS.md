# Using @particle-academy/fancy-passkeys-ui — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm install @particle-academy/fancy-passkeys-ui

# Always
npm install @simplewebauthn/browser

# Only for the React surfaces (skip for ./client-only use)
npm install react react-dom @particle-academy/react-fancy tailwindcss
```

```ts
import "@particle-academy/fancy-passkeys-ui/styles.css";
```

```css
/* your app.css, beside @import "tailwindcss"; (React surfaces only) */
@source '../node_modules/@particle-academy/react-fancy/dist/**/*.{js,cjs,mjs}';
```

- Everything is a peer: `@simplewebauthn/browser >=13.3.0 <15`, `react ^19`,
  `react-dom ^19`, `@particle-academy/react-fancy`, `tailwindcss ^4`.
- **Backend:** `particle-academy/fancy-passkeys` (PHP / Laravel) or
  `@particle-academy/fancy-passkeys` (Node). Both speak the same wire.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). This package's registry entries (`package`
`fancy-passkeys-ui`): `passkey-sign-in`, `passkey-manager`, `passkey-status`.
Find them with `search-components`, then `install-instructions` /
`get-component`. Vendored source: `npx fancy-cli@latest add <slug>`. The
backends are found with `search-backend-packages`.

## API essentials

- **`./client` (React-free):** `createFetchTransport({ baseUrl? })`,
  `registerPasskey(transport, { name? })`,
  `authenticateWithPasskey(transport, { email?, conditional?, signal? })`,
  `normalizeCeremonyError`, `isPasskeySupported`,
  `isPlatformAuthenticatorAvailable`, `isConditionalUiAvailable`,
  `PasskeyCeremonyError`, `PasskeyServerError`.
- **Root (React), plus everything in `./client`:**
  - `<PasskeySignIn value onChange onAuthenticate mode? conditional?>`:
    `mode="discoverable"` (default, one button) or `mode="email"`.
    `onAuthenticate` resolves for success and throws for failure.
  - `<PasskeyManager value onChange onEnroll onRename onRevoke pendingMode?>`.
  - `<PasskeyStatus supported platformAuthenticator conditionalUi>` (visual
    only).
  - `onActivity` emits an `AgentActivity`-shaped `PasskeyActivityEvent` on every
    mutation.
- **Controlled state** is one serializable object, always the full next state
  (`createdAt` is an ISO string).
- **Stable handles:** `data-fancy-passkey-surface`, `data-fancy-passkey-item`
  (keyed by credential id), `data-fancy-passkey-action` (with
  `data-fancy-passkey-id`). Address the surfaces by these.

## Traps

- **Without the react-fancy `@source` line, the React surfaces render
  unstyled.** This package's own classes ship in `styles.css`.
- **The components never call `navigator.credentials`.** The host runs the
  ceremony through `./client` in the callbacks.
- **Listing, renaming and revoking are the app's own routes.** The wire
  contract has only the four ceremony endpoints; there is no `listPasskeys()` in
  `./client`.
- **`pendingMode` defaults to `true`:** Revoke stages a confirmation, and only
  the confirm calls `onRevoke`. `pendingRevoke.isLastPasskey` flags a lockout.
- **A dismissed prompt is `status: "cancelled"`, not an error.**
- **Check `isConditionalUiAvailable()` before setting `conditional`.**

## Letting an agent drive it (MCP bridge)

The bridge ships in `@particle-academy/agent-integrations` 0.34.0 or later, not
in this package:

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

There is deliberately **no** tool that completes a ceremony: no
`passkey_authenticate`, no `passkey_sign_in`, no `passkey_complete`. An agent can
drive everything around a ceremony and never complete one, because the gesture
and biometric belong to the human. Do not wire `proposeRevoke` to a delete.
