import { Badge, cn } from "@particle-academy/react-fancy";

export interface PasskeyStatusProps {
  /** Result of `isPasskeySupported()`. */
  supported: boolean;
  /**
   * Result of `isPlatformAuthenticatorAvailable()`. `null` while unknown.
   * `false` is not a failure — a phone over hybrid or a hardware key still
   * works.
   */
  platformAuthenticator?: boolean | null;
  /** Result of `isConditionalUiAvailable()`. `null` while unknown. */
  conditionalUi?: boolean | null;
  /** Root handle. Default `"passkey-status"`. */
  surfaceId?: string;
  className?: string;
}

/**
 * A read-only "can this browser do passkeys?" indicator.
 *
 * Purely visual, so it owes only the authoring half of the component contract:
 * it takes plain booleans and renders. It runs no detection of its own on
 * purpose — probing inside a component makes it non-deterministic in SSR and in
 * tests, and the host already has the three `./client` predicates.
 */
export function PasskeyStatus({
  supported,
  platformAuthenticator = null,
  conditionalUi = null,
  surfaceId = "passkey-status",
  className,
}: PasskeyStatusProps) {
  return (
    <div
      data-fancy-passkey-surface={surfaceId}
      data-fancy-passkey-supported={String(supported)}
      className={cn("fancy-passkey fancy-passkey-status", className)}
    >
      <Badge variant="soft" color={supported ? "emerald" : "zinc"} data-fancy-passkey-flag="supported">
        {supported ? "Passkeys supported" : "Passkeys unavailable"}
      </Badge>

      {supported && platformAuthenticator !== null ? (
        <Badge
          variant="soft"
          color={platformAuthenticator ? "emerald" : "zinc"}
          data-fancy-passkey-flag="platform-authenticator"
        >
          {platformAuthenticator ? "Built-in authenticator" : "No built-in authenticator"}
        </Badge>
      ) : null}

      {supported && conditionalUi !== null ? (
        <Badge
          variant="soft"
          color={conditionalUi ? "emerald" : "zinc"}
          data-fancy-passkey-flag="conditional-ui"
        >
          {conditionalUi ? "Autofill sign-in" : "No autofill sign-in"}
        </Badge>
      ) : null}
    </div>
  );
}
