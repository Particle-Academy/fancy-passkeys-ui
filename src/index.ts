/**
 * `@particle-academy/fancy-passkeys-ui` — React surfaces for passkey sign-in and
 * passkey management.
 *
 * Everything on `./client` is re-exported here, so a React consumer needs one
 * import. The reverse is not true and must not become true: `./client` stays
 * React-free so a Vue, Svelte, or vanilla frontend can run the same ceremony
 * without React in its tree.
 *
 * Remember to import the stylesheet once:
 * `import "@particle-academy/fancy-passkeys-ui/styles.css";`
 */

// The React-free browser ceremony, surfaced through the root for convenience.
export {
  PasskeyCeremonyError,
  PasskeyServerError,
  normalizeCeremonyError,
  isPasskeySupported,
  isPlatformAuthenticatorAvailable,
  isConditionalUiAvailable,
  createFetchTransport,
  registerPasskey,
  authenticateWithPasskey,
} from "./client";
export type {
  PasskeyCeremonyErrorCode,
  PasskeyCeremonyErrorOptions,
  PasskeyTransport,
  FetchTransportOptions,
  RegisterPasskeyOptions,
  RegisterPasskeyResult,
  AuthenticateWithPasskeyOptions,
  AuthenticateWithPasskeyResult,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "./client";

export type {
  PasskeySummary,
  PasskeyServerErrorCode,
  PasskeyStateError,
  PasskeyActivityAction,
  PasskeyActivityEvent,
} from "./types";

export { PasskeySignIn } from "./PasskeySignIn";
export type {
  PasskeySignInProps,
  PasskeySignInState,
  PasskeySignInStatus,
  PasskeySignInLabelKey,
} from "./PasskeySignIn";

export { PasskeyManager } from "./PasskeyManager";
export type {
  PasskeyManagerProps,
  PasskeyManagerState,
  PasskeyPendingRevoke,
} from "./PasskeyManager";

export { PasskeyStatus } from "./PasskeyStatus";
export type { PasskeyStatusProps } from "./PasskeyStatus";
