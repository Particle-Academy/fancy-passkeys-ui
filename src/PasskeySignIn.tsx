import { useCallback, useRef } from "react";
import { Button, Callout, Input, cn } from "@particle-academy/react-fancy";
import { normalizeCeremonyError } from "./client";
import { activityEvent } from "./activity";
import type { PasskeyActivityEvent, PasskeyStateError } from "./types";

/**
 * Where a sign-in surface is in the ceremony.
 *
 * `cancelled` is a first-class status and **not** an error: the human dismissed
 * the prompt, which is an ordinary thing to do. `checking` and `verifying` are
 * host-set — the component never runs the ceremony, so it cannot know when the
 * browser prompt closed or when the server finished verifying.
 */
export type PasskeySignInStatus =
  | "idle"
  | "checking"
  | "prompting"
  | "verifying"
  | "success"
  | "error"
  | "cancelled"
  | "unsupported";

export interface PasskeySignInState {
  status: PasskeySignInStatus;
  /** Only meaningful in `mode="email"`. Carried always so the state shape is stable. */
  email: string;
  error: PasskeyStateError | null;
}

export type PasskeySignInLabelKey =
  | "button"
  | "emailLabel"
  | "emailPlaceholder"
  | "unsupported"
  | "cancelled"
  | "prompting"
  | "verifying";

export interface PasskeySignInProps {
  value: PasskeySignInState;
  /** Always called with the **full** next state — never a slice. */
  onChange: (next: PasskeySignInState) => void;
  /**
   * Run the ceremony. **Resolve means signed in; throw means it failed** — the
   * component maps a thrown `NotAllowedError` to `status: "cancelled"` and
   * anything else to `status: "error"`.
   *
   * The component deliberately does not call `navigator.credentials` itself.
   * Keeping the ceremony in the host's hands is what makes this surface pure,
   * testable without an authenticator, and impossible to complete from a bridge.
   */
  onAuthenticate: (input: { email?: string }) => Promise<void> | void;
  /**
   * `"discoverable"` (default) shows only the button and takes no username —
   * the usernameless flow the plan optimises for, and the one with nothing to
   * enumerate. `"email"` renders the username-first input.
   */
  mode?: "discoverable" | "email";
  /** Root handle. Default `"passkey-sign-in"`. */
  surfaceId?: string;
  labels?: Partial<Record<PasskeySignInLabelKey, string>>;
  /**
   * Opt into conditional UI (autofill). In `mode="email"` this switches the
   * input to `autocomplete="username webauthn"`, which is what makes the browser
   * offer a passkey from the field itself.
   */
  conditional?: boolean;
  onActivity?: (event: PasskeyActivityEvent) => void;
  className?: string;
}

const DEFAULT_LABELS: Record<PasskeySignInLabelKey, string> = {
  button: "Sign in with a passkey",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  unsupported: "This browser can't use passkeys. Sign in another way, or try a different browser.",
  cancelled: "Passkey sign-in was cancelled. You can try again whenever you like.",
  prompting: "Waiting for your passkey…",
  verifying: "Verifying your passkey…",
};

const BUSY: ReadonlySet<PasskeySignInStatus> = new Set(["checking", "prompting", "verifying"]);

/**
 * A controlled passkey sign-in surface.
 *
 * Everything an agent can meaningfully do here — read the status, read the
 * error, fill the email field, press the button — is state and has a handle.
 * The one thing it cannot do is finish the ceremony, because
 * `navigator.credentials.get()` wants a user gesture and a biometric. That is
 * not a gap in the bridge; it is the property that makes a passkey worth having.
 */
export function PasskeySignIn({
  value,
  onChange,
  onAuthenticate,
  mode = "discoverable",
  surfaceId = "passkey-sign-in",
  labels,
  conditional,
  onActivity,
  className,
}: PasskeySignInProps) {
  // The latest rendered state, read at the moment an async handler resolves so a
  // full-state emission is built from what the surface currently shows rather
  // than from a closure captured before the await.
  const valueRef = useRef(value);
  valueRef.current = value;

  const label = (key: PasskeySignInLabelKey): string => labels?.[key] ?? DEFAULT_LABELS[key];

  const emit = useCallback(
    (event: PasskeyActivityEvent) => {
      onActivity?.(event);
    },
    [onActivity],
  );

  const authenticate = useCallback(async () => {
    const current = valueRef.current;
    if (current.status === "unsupported" || BUSY.has(current.status)) return;

    const email = mode === "email" ? current.email : undefined;

    emit(activityEvent(surfaceId, "authenticate", undefined, { mode, conditional: !!conditional }));
    onChange({ ...current, status: "prompting", error: null });

    try {
      await onAuthenticate(email === undefined ? {} : { email });
      onChange({ ...valueRef.current, status: "success", error: null });
    } catch (err) {
      const failure = normalizeCeremonyError(err);
      if (failure.code === "cancelled") {
        // Not a failure. Rendered as a muted hint, never as an alert.
        onChange({ ...valueRef.current, status: "cancelled", error: null });
        emit(activityEvent(surfaceId, "cancelled"));
        return;
      }
      const error: PasskeyStateError = {
        code: failure.serverCode ?? failure.code,
        message: failure.message,
      };
      onChange({ ...valueRef.current, status: "error", error });
      emit(activityEvent(surfaceId, "error", undefined, { code: error.code }));
    }
  }, [conditional, emit, mode, onAuthenticate, onChange, surfaceId]);

  const unsupported = value.status === "unsupported";
  const busy = BUSY.has(value.status);

  const hint =
    value.status === "unsupported"
      ? { key: "unsupported" as const, text: label("unsupported") }
      : value.status === "cancelled"
        ? { key: "cancelled" as const, text: label("cancelled") }
        : value.status === "prompting"
          ? { key: "prompting" as const, text: label("prompting") }
          : value.status === "verifying"
            ? { key: "verifying" as const, text: label("verifying") }
            : null;

  const button = (
    <Button
      type="button"
      color="blue"
      icon="fingerprint"
      loading={busy}
      disabled={unsupported || busy || value.status === "success"}
      onClick={() => void authenticate()}
      data-fancy-passkey-action="authenticate"
      data-fancy-passkey-surface-id={surfaceId}
    >
      {label("button")}
    </Button>
  );

  return (
    <div
      data-fancy-passkey-surface={surfaceId}
      data-fancy-passkey-status={value.status}
      data-fancy-passkey-mode={mode}
      className={cn("fancy-passkey fancy-passkey-signin", className)}
    >
      {mode === "email" ? (
        <form
          className="fancy-passkey-signin__form"
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate();
          }}
        >
          <Input
            type="email"
            name="email"
            label={label("emailLabel")}
            placeholder={label("emailPlaceholder")}
            value={value.email}
            disabled={unsupported || busy}
            // The `webauthn` token is what lets the browser surface a passkey
            // from inside the field. Without conditional UI it is a plain
            // username field and claiming otherwise would be a lie to the
            // autofill engine.
            autoComplete={conditional ? "username webauthn" : "username"}
            data-fancy-passkey-field="email"
            onChange={(event) => onChange({ ...valueRef.current, email: event.target.value })}
          />
          {button}
        </form>
      ) : (
        button
      )}

      {/* `Callout` already carries `role="alert"`, so this wrapper carries only
          the handle — nesting a second alert makes the region ambiguous to a
          screen reader and to `getByRole`. */}
      {value.status === "error" && value.error ? (
        <div data-fancy-passkey-error={value.error.code} className="fancy-passkey__error">
          <Callout color="red">{value.error.message}</Callout>
        </div>
      ) : null}

      {hint ? (
        <p data-fancy-passkey-hint={hint.key} className="fancy-passkey__hint">
          {hint.text}
        </p>
      ) : null}
    </div>
  );
}
