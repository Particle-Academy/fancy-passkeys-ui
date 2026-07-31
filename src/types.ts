/**
 * Shared, **type-only** vocabulary for both entry points.
 *
 * Nothing in this file emits runtime code, which is what lets the React-free
 * `./client` entry and the React entry share it without either one dragging the
 * other into a consumer's bundle.
 */

/**
 * One registered credential, exactly as both backends serialise it
 * (`PasskeySummaryJSON` in the wire contract).
 *
 * Every field is JSON-primitive on purpose: `createdAt` is an ISO string rather
 * than a `Date` so a whole surface state survives
 * `JSON.parse(JSON.stringify(state))` unchanged — the property an agent needs in
 * order to read a surface back out and write one in.
 */
export interface PasskeySummary {
  /** base64url credential ID. Globally unique, and the handle every agent-facing action is keyed by. */
  id: string;
  /** Human-chosen label ("MacBook Touch ID"). `null` when the user never named it. */
  name: string | null;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601, or `null` when the credential has never been used to sign in. */
  lastUsedAt: string | null;
  /** Transport hints reported at registration ("internal", "hybrid", "usb", …). */
  transports: string[];
  /** True for a *synced* passkey (the BE/BS flags). False means this device only. */
  backedUp: boolean;
  /** Authenticator model identifier. Stored, never used for a trust decision in v1. */
  aaguid: string;
  /**
   * ISO-8601 when the signature counter regressed for this credential — i.e. the
   * server saw evidence the private key may have been cloned. A security event,
   * and the surfaces render it as one.
   */
  clonedAt: string | null;
}

/**
 * The closed set of error codes both backends emit in
 * `{ "error": { "code", "message" } }`. Kept as a union *plus* `string` at the
 * call sites so a newer backend adding a code does not become a type error in an
 * older UI.
 */
export type PasskeyServerErrorCode =
  | "challenge_expired"
  | "challenge_not_found"
  | "challenge_type_mismatch"
  | "origin_not_allowed"
  | "rp_id_mismatch"
  | "unknown_credential"
  | "credential_already_registered"
  | "counter_regressed"
  | "user_verification_required"
  | "user_handle_mismatch"
  | "verification_failed"
  | "invalid_response"
  | "not_supported";

/**
 * The error shape carried *in surface state* — a plain object, not an `Error`,
 * because state has to be serialisable.
 */
export interface PasskeyStateError {
  /** A `PasskeyServerErrorCode` when the server rejected, otherwise a `PasskeyCeremonyErrorCode`. */
  code: string;
  message: string;
}

/** Every mutation a surface can report. */
export type PasskeyActivityAction =
  | "authenticate"
  | "enroll"
  | "rename"
  | "revoke-proposed"
  | "revoke-confirmed"
  | "revoke-cancelled"
  | "cancelled"
  | "error";

/**
 * `AgentActivity`-shaped event emitted on every mutation, so presence, undo and
 * coaching layers compose without this package knowing about them.
 */
export interface PasskeyActivityEvent {
  /** The `surfaceId` of the emitting surface. */
  surface: string;
  action: PasskeyActivityAction;
  /** Credential ID, where the action has one. */
  target?: string;
  /** ISO-8601. */
  at: string;
  detail?: Record<string, unknown>;
}
