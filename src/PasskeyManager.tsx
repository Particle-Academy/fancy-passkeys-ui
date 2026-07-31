import { useCallback, useRef } from "react";
import { Badge, Button, Callout, Input, cn } from "@particle-academy/react-fancy";
import { normalizeCeremonyError } from "./client";
import { activityEvent, isoDate } from "./activity";
import type { PasskeyActivityEvent, PasskeyStateError, PasskeySummary } from "./types";

export interface PasskeyPendingRevoke {
  /** Credential ID staged for revocation. */
  id: string;
  /**
   * True when this is the account's only remaining passkey — i.e. confirming
   * locks the user out of passkey sign-in entirely. Computed by the component
   * and rendered in the confirmation copy, because "are you sure?" has not
   * actually warned anyone.
   */
  isLastPasskey: boolean;
}

export interface PasskeyManagerState {
  passkeys: PasskeySummary[];
  pendingRevoke: PasskeyPendingRevoke | null;
  renamingId: string | null;
  draftName: string;
  status: "idle" | "busy" | "error";
  error: PasskeyStateError | null;
}

export interface PasskeyManagerProps {
  value: PasskeyManagerState;
  /** Always called with the **full** next state — never a slice. */
  onChange: (next: PasskeyManagerState) => void;
  onRename?: (input: { id: string; name: string }) => Promise<void> | void;
  onRevoke?: (input: { id: string }) => Promise<void> | void;
  /**
   * Start enrolling a new passkey. The ceremony itself belongs to the host (and
   * to the human at the keyboard) — this is only the intent.
   */
  onEnroll?: () => Promise<void> | void;
  /**
   * Stage revokes for human confirmation instead of performing them.
   * **Defaults to `true`**: revoking is destructive, revoking the last passkey
   * is a lockout, and this is exactly the action the trust-but-verify hook
   * exists for. Set `false` only when something else already confirmed.
   */
  pendingMode?: boolean;
  /** Root handle. Default `"passkey-manager"`. */
  surfaceId?: string;
  onActivity?: (event: PasskeyActivityEvent) => void;
  emptyLabel?: string;
  className?: string;
}

/**
 * A controlled list of a user's passkeys, with rename and revoke.
 *
 * Every row is handled by **credential ID** (`data-fancy-passkey-item`), never
 * by list index. An index-keyed handle points at a different credential after a
 * sort or a revoke, so "revoke the one the agent named" silently revokes
 * somebody else's laptop — and nothing reports it.
 */
export function PasskeyManager({
  value,
  onChange,
  onRename,
  onRevoke,
  onEnroll,
  pendingMode = true,
  surfaceId = "passkey-manager",
  onActivity,
  emptyLabel = "No passkeys yet.",
  className,
}: PasskeyManagerProps) {
  // See PasskeySignIn: read the latest rendered state when an async handler
  // resolves, so the full-state emission reflects what the surface now shows.
  const valueRef = useRef(value);
  valueRef.current = value;

  const emit = useCallback(
    (event: PasskeyActivityEvent) => {
      onActivity?.(event);
    },
    [onActivity],
  );

  const fail = useCallback(
    (err: unknown, target?: string) => {
      const failure = normalizeCeremonyError(err);
      const error: PasskeyStateError = {
        code: failure.serverCode ?? failure.code,
        message: failure.message,
      };
      onChange({ ...valueRef.current, status: "error", error });
      emit(activityEvent(surfaceId, "error", target, { code: error.code }));
    },
    [emit, onChange, surfaceId],
  );

  const startRename = useCallback(
    (passkey: PasskeySummary) => {
      onChange({
        ...valueRef.current,
        renamingId: passkey.id,
        draftName: passkey.name ?? "",
        error: null,
      });
    },
    [onChange],
  );

  const cancelRename = useCallback(() => {
    onChange({ ...valueRef.current, renamingId: null, draftName: "" });
  }, [onChange]);

  const commitRename = useCallback(
    async (id: string) => {
      const name = valueRef.current.draftName.trim();
      emit(activityEvent(surfaceId, "rename", id, { name }));
      onChange({ ...valueRef.current, status: "busy", error: null });
      try {
        await onRename?.({ id, name });
        const current = valueRef.current;
        onChange({
          ...current,
          passkeys: current.passkeys.map((passkey) =>
            passkey.id === id ? { ...passkey, name: name.length > 0 ? name : null } : passkey,
          ),
          renamingId: null,
          draftName: "",
          status: "idle",
          error: null,
        });
      } catch (err) {
        fail(err, id);
      }
    },
    [emit, fail, onChange, onRename, surfaceId],
  );

  const performRevoke = useCallback(
    async (id: string) => {
      onChange({ ...valueRef.current, status: "busy", error: null });
      try {
        await onRevoke?.({ id });
        const current = valueRef.current;
        onChange({
          ...current,
          passkeys: current.passkeys.filter((passkey) => passkey.id !== id),
          pendingRevoke: null,
          renamingId: current.renamingId === id ? null : current.renamingId,
          status: "idle",
          error: null,
        });
      } catch (err) {
        fail(err, id);
      }
    },
    [fail, onChange, onRevoke],
  );

  const proposeRevoke = useCallback(
    (id: string) => {
      const current = valueRef.current;
      const isLastPasskey = current.passkeys.length <= 1;

      if (!pendingMode) {
        emit(activityEvent(surfaceId, "revoke-confirmed", id, { isLastPasskey, staged: false }));
        void performRevoke(id);
        return;
      }

      emit(activityEvent(surfaceId, "revoke-proposed", id, { isLastPasskey }));
      onChange({ ...current, pendingRevoke: { id, isLastPasskey }, error: null });
    },
    [emit, onChange, pendingMode, performRevoke, surfaceId],
  );

  const confirmRevoke = useCallback(
    (id: string) => {
      const isLastPasskey = valueRef.current.pendingRevoke?.isLastPasskey ?? false;
      emit(activityEvent(surfaceId, "revoke-confirmed", id, { isLastPasskey, staged: true }));
      void performRevoke(id);
    },
    [emit, performRevoke, surfaceId],
  );

  const cancelRevoke = useCallback(
    (id: string) => {
      emit(activityEvent(surfaceId, "revoke-cancelled", id));
      onChange({ ...valueRef.current, pendingRevoke: null });
    },
    [emit, onChange, surfaceId],
  );

  const enroll = useCallback(async () => {
    emit(activityEvent(surfaceId, "enroll"));
    onChange({ ...valueRef.current, status: "busy", error: null });
    try {
      await onEnroll?.();
      onChange({ ...valueRef.current, status: "idle", error: null });
    } catch (err) {
      fail(err);
    }
  }, [emit, fail, onChange, onEnroll, surfaceId]);

  const busy = value.status === "busy";

  return (
    <div
      data-fancy-passkey-surface={surfaceId}
      data-fancy-passkey-status={value.status}
      className={cn("fancy-passkey fancy-passkey-manager", className)}
    >
      {/* `Callout` already carries `role="alert"`; these wrappers carry only the
          handle, so a surface never nests two alerts. */}
      {value.error ? (
        <div data-fancy-passkey-error={value.error.code} className="fancy-passkey__error">
          <Callout color="red">{value.error.message}</Callout>
        </div>
      ) : null}

      {value.passkeys.length === 0 ? (
        <p data-fancy-passkey-empty="" className="fancy-passkey__hint">
          {emptyLabel}
        </p>
      ) : (
        <ul className="fancy-passkey-manager__list">
          {value.passkeys.map((passkey) => {
            const renaming = value.renamingId === passkey.id;
            const pending = value.pendingRevoke?.id === passkey.id ? value.pendingRevoke : null;

            return (
              <li
                key={passkey.id}
                data-fancy-passkey-item={passkey.id}
                className="fancy-passkey-manager__row"
              >
                <div className="fancy-passkey-manager__main">
                  {renaming ? (
                    <Input
                      type="text"
                      value={value.draftName}
                      placeholder="Name this passkey"
                      disabled={busy}
                      data-fancy-passkey-field="name"
                      data-fancy-passkey-id={passkey.id}
                      onChange={(event) =>
                        onChange({ ...valueRef.current, draftName: event.target.value })
                      }
                    />
                  ) : (
                    <span data-fancy-passkey-name={passkey.id} className="fancy-passkey-manager__name">
                      {passkey.name ?? "Unnamed passkey"}
                    </span>
                  )}

                  <span className="fancy-passkey-manager__meta">
                    <Badge variant="soft" data-fancy-passkey-backed-up={String(passkey.backedUp)}>
                      {passkey.backedUp ? "Synced" : "This device only"}
                    </Badge>
                    {passkey.transports.length > 0 ? (
                      <span data-fancy-passkey-transports={passkey.transports.join(" ")}>
                        {passkey.transports.join(", ")}
                      </span>
                    ) : null}
                    <span>
                      Added <time dateTime={passkey.createdAt}>{isoDate(passkey.createdAt)}</time>
                    </span>
                    <span>
                      {passkey.lastUsedAt ? (
                        <>
                          Last used{" "}
                          <time dateTime={passkey.lastUsedAt}>{isoDate(passkey.lastUsedAt)}</time>
                        </>
                      ) : (
                        "Never used"
                      )}
                    </span>
                  </span>
                </div>

                {passkey.clonedAt ? (
                  <div
                    data-fancy-passkey-cloned={passkey.id}
                    className="fancy-passkey-manager__cloned"
                  >
                    <Callout color="red">
                      Possible clone detected on{" "}
                      <time dateTime={passkey.clonedAt}>{isoDate(passkey.clonedAt)}</time>. This
                      credential&apos;s signature counter went backwards, which means the private
                      key may exist on more than one device. Revoke it.
                    </Callout>
                  </div>
                ) : null}

                <div className="fancy-passkey-manager__actions">
                  {renaming ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        color="blue"
                        disabled={busy}
                        data-fancy-passkey-action="save-rename"
                        data-fancy-passkey-id={passkey.id}
                        onClick={() => void commitRename(passkey.id)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        data-fancy-passkey-action="cancel-rename"
                        data-fancy-passkey-id={passkey.id}
                        onClick={cancelRename}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      icon="pencil"
                      disabled={busy}
                      data-fancy-passkey-action="rename"
                      data-fancy-passkey-id={passkey.id}
                      onClick={() => startRename(passkey)}
                    >
                      Rename
                    </Button>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon="trash-2"
                    warn
                    disabled={busy || pending !== null}
                    data-fancy-passkey-action="revoke"
                    data-fancy-passkey-id={passkey.id}
                    onClick={() => proposeRevoke(passkey.id)}
                  >
                    Revoke
                  </Button>
                </div>

                {pending ? (
                  <div
                    role="alertdialog"
                    aria-label="Confirm passkey revocation"
                    data-fancy-passkey-confirm={pending.id}
                    data-fancy-passkey-last={String(pending.isLastPasskey)}
                    className="fancy-passkey-manager__confirm"
                  >
                    <Callout color={pending.isLastPasskey ? "red" : "amber"}>
                      {pending.isLastPasskey
                        ? `This is your last passkey. Revoking “${passkey.name ?? "Unnamed passkey"}” removes the only passkey on this account — if it is also your only way in, you will be locked out.`
                        : `Revoke “${passkey.name ?? "Unnamed passkey"}”? That authenticator will no longer be able to sign in.`}
                    </Callout>
                    <div className="fancy-passkey-manager__actions">
                      <Button
                        type="button"
                        size="sm"
                        color="red"
                        disabled={busy}
                        data-fancy-passkey-action="confirm-revoke"
                        data-fancy-passkey-id={pending.id}
                        onClick={() => confirmRevoke(pending.id)}
                      >
                        Revoke passkey
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        data-fancy-passkey-action="cancel-revoke"
                        data-fancy-passkey-id={pending.id}
                        onClick={() => cancelRevoke(pending.id)}
                      >
                        Keep it
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {onEnroll ? (
        <div className="fancy-passkey-manager__footer">
          <Button
            type="button"
            color="blue"
            icon="plus"
            loading={busy}
            disabled={busy}
            data-fancy-passkey-action="enroll"
            data-fancy-passkey-surface-id={surfaceId}
            onClick={() => void enroll()}
          >
            Add a passkey
          </Button>
        </div>
      ) : null}
    </div>
  );
}
