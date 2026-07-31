/**
 * `@particle-academy/fancy-passkeys-ui/client` — the browser half of both
 * WebAuthn ceremonies, with **zero React**.
 *
 * Every frontend needs this code and only some of them are React, so it lives
 * behind its own entry point: importing the React surfaces never costs you a
 * second copy of the ceremony, and importing the ceremony never costs a Vue or
 * Svelte app a React dependency. `packaging.test.ts` asserts the built
 * `dist/client.js` contains no React import — if that test fails, something
 * moved into the wrong entry.
 *
 * What this module does NOT contain is anything that lets a caller *complete* a
 * ceremony without the human at the keyboard. `navigator.credentials.get()`
 * needs a user gesture and a biometric or PIN, and both of those are things only
 * a person has. That boundary is the whole reason a passkey is worth having, so
 * it is not softened here and will not grow an escape hatch.
 */

import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { PasskeyServerErrorCode, PasskeySummary } from "./types";

export type {
  PasskeySummary,
  PasskeyServerErrorCode,
  PasskeyStateError,
  PasskeyActivityAction,
  PasskeyActivityEvent,
} from "./types";

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * How a ceremony ended, from the browser's point of view.
 *
 * `cancelled` is deliberately its own code and **is not a failure**. The browser
 * reports "the human dismissed the prompt" and "the prompt timed out" with the
 * same `NotAllowedError` it would use for a genuine refusal, and a sign-in
 * surface that paints abandonment red teaches people the surface is broken.
 */
export type PasskeyCeremonyErrorCode =
  | "cancelled"
  | "not_supported"
  | "already_registered"
  | "security_error"
  | "ceremony_failed";

export interface PasskeyCeremonyErrorOptions {
  /** The original `DOMException` / `WebAuthnError` / transport rejection. */
  cause?: unknown;
  /** The backend's own `PasskeyErrorCode`, when the failure came from a response body. */
  serverCode?: string;
  /** HTTP status, when the failure came from a response. */
  status?: number;
}

/** Every rejection from this module is one of these. */
export class PasskeyCeremonyError extends Error {
  readonly code: PasskeyCeremonyErrorCode;
  /**
   * The backend's own error code, preserved verbatim rather than flattened
   * into `ceremony_failed`.
   *
   * Note that the first-party backends deliberately redact
   * `unknown_credential`, `user_handle_mismatch` and `counter_regressed` to
   * `verification_failed` before they reach the wire — each answers a question
   * about a credential the server holds, and an unauthenticated caller has no
   * business asking. Do not branch on those three; they will never arrive.
   */
  readonly serverCode?: string;
  readonly status?: number;
  // Declared here rather than `override`n: the package targets ES2021, whose
  // `Error` has no `cause` to override.
  readonly cause?: unknown;

  constructor(
    code: PasskeyCeremonyErrorCode,
    message: string,
    options: PasskeyCeremonyErrorOptions = {},
  ) {
    super(message);
    this.name = "PasskeyCeremonyError";
    this.code = code;
    if (options.serverCode !== undefined) this.serverCode = options.serverCode;
    if (options.status !== undefined) this.status = options.status;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * A 4xx from either backend, carrying the wire contract's
 * `{ "error": { "code", "message" } }` payload.
 *
 * It extends {@link PasskeyCeremonyError} so `instanceof PasskeyCeremonyError`
 * still catches everything, while `serverCode` stays exact.
 */
export class PasskeyServerError extends PasskeyCeremonyError {
  override readonly serverCode: string;

  constructor(
    serverCode: PasskeyServerErrorCode | string,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(ceremonyCodeForServerCode(serverCode), message, { ...options, serverCode });
    this.name = "PasskeyServerError";
    this.serverCode = serverCode;
  }
}

function ceremonyCodeForServerCode(serverCode: string): PasskeyCeremonyErrorCode {
  switch (serverCode) {
    case "credential_already_registered":
      return "already_registered";
    case "origin_not_allowed":
    case "rp_id_mismatch":
    case "user_handle_mismatch":
      return "security_error";
    case "not_supported":
      return "not_supported";
    default:
      return "ceremony_failed";
  }
}

function nameOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function messageOf(err: unknown, fallback: string): string {
  if (typeof err !== "object" || err === null) return fallback;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/**
 * Turn anything a ceremony can throw into a typed {@link PasskeyCeremonyError}.
 *
 * The mapping that matters:
 *
 * | thrown | code |
 * |---|---|
 * | `NotAllowedError` | `cancelled` — the human dismissed it or it timed out |
 * | `AbortError` | `cancelled` — the host tore the ceremony down (see `signal`) |
 * | `InvalidStateError` | `already_registered` — this authenticator already holds a credential for this account |
 * | `SecurityError` | `security_error` — RP ID / origin does not match |
 * | `NotSupportedError` | `not_supported` |
 * | anything else | `ceremony_failed` |
 *
 * `@simplewebauthn/browser` wraps the `DOMException` in a `WebAuthnError` whose
 * `name` defaults to the underlying exception's, so both shapes land in the same
 * rows; the `cause` chain is checked too for the cases where it does not.
 *
 * An error that is already a `PasskeyCeremonyError` (including a
 * {@link PasskeyServerError}) is returned untouched — that is what stops a
 * server's own code being flattened into `ceremony_failed` by a caller that
 * normalises defensively.
 */
export function normalizeCeremonyError(err: unknown): PasskeyCeremonyError {
  if (err instanceof PasskeyCeremonyError) return err;

  const names = [nameOf(err), nameOf((err as { cause?: unknown } | null)?.cause)];

  for (const name of names) {
    switch (name) {
      case "NotAllowedError":
        return new PasskeyCeremonyError(
          "cancelled",
          messageOf(err, "The passkey prompt was dismissed or timed out."),
          { cause: err },
        );
      case "AbortError":
        return new PasskeyCeremonyError(
          "cancelled",
          messageOf(err, "The passkey ceremony was aborted."),
          { cause: err },
        );
      case "InvalidStateError":
        return new PasskeyCeremonyError(
          "already_registered",
          messageOf(err, "This device already holds a passkey for this account."),
          { cause: err },
        );
      case "SecurityError":
        return new PasskeyCeremonyError(
          "security_error",
          messageOf(err, "The passkey could not be used on this origin."),
          { cause: err },
        );
      case "NotSupportedError":
        return new PasskeyCeremonyError(
          "not_supported",
          messageOf(err, "This browser or authenticator does not support passkeys."),
          { cause: err },
        );
      default:
        break;
    }
  }

  return new PasskeyCeremonyError("ceremony_failed", messageOf(err, "The passkey ceremony failed."), {
    cause: err,
  });
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

/**
 * Whether this browser can do WebAuthn at all.
 *
 * Checked directly rather than delegated, so it is honest in an SSR pass, in a
 * test environment, and in an insecure context — all three of which are places a
 * surface renders before any authenticator exists.
 */
export function isPasskeySupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (typeof (globalThis as Record<string, unknown>)["PublicKeyCredential"] !== "function") {
    return false;
  }
  const credentials = navigator.credentials as CredentialsContainer | undefined;
  return typeof credentials?.create === "function" && typeof credentials.get === "function";
}

/**
 * Whether a *platform* authenticator (Touch ID, Windows Hello, Android
 * biometrics) is present. `false` does not mean passkeys are unavailable — a
 * phone over hybrid, or a hardware key, still works.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/**
 * Whether the browser can offer a passkey from inside a username field
 * (conditional UI / autofill). Only worth acting on when you render
 * `mode="email"`.
 */
export async function isConditionalUiAvailable(): Promise<boolean> {
  if (!isPasskeySupported()) return false;
  try {
    return await browserSupportsWebAuthnAutofill();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * How the ceremony reaches your backend.
 *
 * Deliberately one method. Both backends expose four POST endpoints and nothing
 * else, so an app that routes through Inertia, axios, a fetch wrapper with
 * retries, or its own auth headers implements this in four lines instead of
 * configuring ours.
 */
export interface PasskeyTransport {
  /**
   * POST `path` (relative to whatever prefix the transport owns) and resolve
   * with the decoded JSON body. **Reject on a non-2xx** — ideally with a
   * {@link PasskeyServerError} so the backend's own error code survives.
   */
  post(path: string, body?: unknown): Promise<unknown>;
}

export interface FetchTransportOptions {
  /**
   * Route prefix both backends mount their four endpoints under.
   * Default `"/passkeys"`. A trailing slash is trimmed.
   */
  baseUrl?: string;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Default `"same-origin"` — a passkey session is a cookie session. */
  credentials?: RequestCredentials;
  /**
   * Laravel CSRF token, or a getter for one (useful when the token rotates).
   *
   * When omitted the transport reads the `XSRF-TOKEN` cookie, which is what a
   * Laravel app already sets and what `axios` would have sent.
   */
  csrfToken?: string | (() => string | null);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) return decodeURIComponent(entry.slice(prefix.length));
  }
  return null;
}

/**
 * The transport most apps want: `fetch`, JSON in and out, same-origin cookies,
 * and Laravel's CSRF header filled in.
 *
 * A non-2xx carrying the wire contract's `{ error: { code, message } }` becomes
 * a {@link PasskeyServerError} with that exact `code`.
 */
export function createFetchTransport(options: FetchTransportOptions = {}): PasskeyTransport {
  const baseUrl = (options.baseUrl ?? "/passkeys").replace(/\/+$/, "");
  const credentials = options.credentials ?? "same-origin";

  return {
    async post(path: string, body?: unknown): Promise<unknown> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const explicitToken =
        typeof options.csrfToken === "function" ? options.csrfToken() : options.csrfToken;

      if (explicitToken) {
        // Laravel reads `X-CSRF-TOKEN` first and only falls back to
        // `X-XSRF-TOKEN` (the encrypted cookie form) when it is absent, so
        // sending both lets the same option carry either kind of token.
        headers["X-CSRF-TOKEN"] = explicitToken;
        headers["X-XSRF-TOKEN"] = explicitToken;
      } else {
        const cookieToken = readCookie("XSRF-TOKEN");
        if (cookieToken) headers["X-XSRF-TOKEN"] = cookieToken;
      }

      Object.assign(headers, options.headers ?? {});

      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        credentials,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await response.text();
      let payload: unknown;
      if (text.length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = undefined;
        }
      }

      if (!response.ok) {
        const wire = (payload as { error?: { code?: unknown; message?: unknown } } | undefined)
          ?.error;
        if (wire && typeof wire.code === "string") {
          throw new PasskeyServerError(
            wire.code,
            typeof wire.message === "string" ? wire.message : "The passkey request was rejected.",
            { status: response.status },
          );
        }
        throw new PasskeyCeremonyError(
          "ceremony_failed",
          `The passkey request failed (HTTP ${response.status}).`,
          { status: response.status },
        );
      }

      return payload;
    },
  };
}

// ---------------------------------------------------------------------------
// Ceremonies
// ---------------------------------------------------------------------------

/** `POST {prefix}/register/options` and `POST {prefix}/login/options` both return this. */
interface OptionsResponse<T> {
  state: string;
  publicKey: T;
}

export interface RegisterPasskeyOptions {
  /** Label for the new credential, e.g. "MacBook Touch ID". */
  name?: string;
}

export interface RegisterPasskeyResult {
  credential: PasskeySummary;
}

/**
 * Enroll a new passkey for the **already authenticated** user.
 *
 * Two round trips, exactly as the wire contract specifies:
 *
 * 1. `POST {prefix}/register/options` → `{ state, publicKey }`
 * 2. `navigator.credentials.create()` via `startRegistration`
 * 3. `POST {prefix}/register` with `{ state, name?, response }` → `{ credential }`
 *
 * The `state` handle is round-tripped untouched. It is an opaque pointer to the
 * server-side challenge record, which is single-use and pulled before
 * verification — so a replayed response fails at "no such challenge" whether or
 * not its signature is valid.
 */
export async function registerPasskey(
  transport: PasskeyTransport,
  options: RegisterPasskeyOptions = {},
): Promise<RegisterPasskeyResult> {
  try {
    if (!isPasskeySupported()) {
      throw new PasskeyCeremonyError(
        "not_supported",
        "This browser does not support passkeys.",
      );
    }

    const begun = (await transport.post(
      "/register/options",
    )) as OptionsResponse<PublicKeyCredentialCreationOptionsJSON>;

    const response: RegistrationResponseJSON = await startRegistration({
      optionsJSON: begun.publicKey,
    });

    const body: { state: string; name?: string; response: RegistrationResponseJSON } = {
      state: begun.state,
      response,
    };
    if (options.name !== undefined) body.name = options.name;

    return (await transport.post("/register", body)) as RegisterPasskeyResult;
  } catch (err) {
    throw normalizeCeremonyError(err);
  }
}

export interface AuthenticateWithPasskeyOptions {
  /**
   * Username-first flow. Omit for the discoverable (usernameless) flow, which is
   * the one v1 optimises for and the one that has nothing to enumerate.
   */
  email?: string;
  /**
   * Start a conditional-UI (autofill) ceremony instead of a modal one. Pair it
   * with an `autocomplete="username webauthn"` input, and check
   * {@link isConditionalUiAvailable} first.
   */
  conditional?: boolean;
  /**
   * Tear the ceremony down — the case that actually matters is a long-lived
   * conditional-UI request that outlives the route that started it.
   *
   * Aborting calls `WebAuthnAbortService.cancelCeremony()`, so the browser's own
   * prompt closes rather than being merely ignored, and the promise settles as
   * `cancelled` (never `ceremony_failed`).
   */
  signal?: AbortSignal;
}

export interface AuthenticateWithPasskeyResult {
  /** Whatever the backend considers a user. Opaque here on purpose. */
  user: unknown;
  credential: PasskeySummary;
}

/**
 * Sign in with a passkey.
 *
 * 1. `POST {prefix}/login/options` (body `{ email }` only when one was given) → `{ state, publicKey }`
 * 2. `navigator.credentials.get()` via `startAuthentication`
 * 3. `POST {prefix}/login` with `{ state, response }` → `{ user, credential }`
 *
 * There is no variant of this function an agent can complete, and there is not
 * going to be one. Step 2 requires a user gesture and a biometric or PIN.
 */
export async function authenticateWithPasskey(
  transport: PasskeyTransport,
  options: AuthenticateWithPasskeyOptions = {},
): Promise<AuthenticateWithPasskeyResult> {
  const { signal } = options;

  try {
    if (!isPasskeySupported()) {
      throw new PasskeyCeremonyError(
        "not_supported",
        "This browser does not support passkeys.",
      );
    }
    throwIfAborted(signal);

    const begun = (await transport.post(
      "/login/options",
      options.email === undefined ? undefined : { email: options.email },
    )) as OptionsResponse<PublicKeyCredentialRequestOptionsJSON>;

    throwIfAborted(signal);

    const response = await withCeremonyAbort(signal, () =>
      startAuthentication({
        optionsJSON: begun.publicKey,
        useBrowserAutofill: options.conditional === true,
      }),
    );

    throwIfAborted(signal);

    return (await transport.post("/login", {
      state: begun.state,
      response,
    })) as AuthenticateWithPasskeyResult;
  } catch (err) {
    throw normalizeCeremonyError(err);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PasskeyCeremonyError("cancelled", "The passkey ceremony was aborted.");
  }
}

/**
 * Run a ceremony, wiring `signal` to the library's abort singleton so an abort
 * closes the browser prompt instead of leaving it up while we walk away.
 */
async function withCeremonyAbort<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!signal) return run();

  const cancel = () => {
    WebAuthnAbortService.cancelCeremony();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await run();
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
