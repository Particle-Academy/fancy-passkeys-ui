import { describe, expect, it } from "vitest";
import type { PasskeyManagerState } from "./PasskeyManager";
import type { PasskeySignInState } from "./PasskeySignIn";
import type { PasskeyActivityEvent, PasskeySummary } from "./types";

/**
 * The whole Human+ contract rests on a surface being readable and writable as
 * JSON. `createdAt` is an ISO string rather than a `Date` for exactly this
 * reason — a `Date` survives `JSON.stringify` and comes back a string, so a
 * round-trip that "looks fine" silently changes the type an agent reads.
 */
function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SUMMARY: PasskeySummary = {
  id: "cred-abc",
  name: "MacBook Touch ID",
  createdAt: "2026-07-30T10:00:00.000Z",
  lastUsedAt: "2026-07-31T08:30:00.000Z",
  transports: ["internal", "hybrid"],
  backedUp: true,
  aaguid: "adce0002-35bc-c60a-648b-0b25f1f05503",
  clonedAt: "2026-07-31T09:00:00.000Z",
};

describe("state serialization", () => {
  it("round-trips a PasskeySummary unchanged", () => {
    expect(roundTrip(SUMMARY)).toEqual(SUMMARY);
  });

  it("round-trips every PasskeySignInState shape unchanged", () => {
    const states: PasskeySignInState[] = [
      { status: "idle", email: "", error: null },
      { status: "prompting", email: "ada@example.test", error: null },
      { status: "cancelled", email: "", error: null },
      { status: "unsupported", email: "", error: null },
      {
        status: "error",
        email: "ada@example.test",
        error: { code: "counter_regressed", message: "Counter regressed." },
      },
    ];

    for (const state of states) {
      expect(roundTrip(state)).toEqual(state);
    }
  });

  it("round-trips every PasskeyManagerState shape unchanged", () => {
    const states: PasskeyManagerState[] = [
      {
        passkeys: [],
        pendingRevoke: null,
        renamingId: null,
        draftName: "",
        status: "idle",
        error: null,
      },
      {
        passkeys: [SUMMARY, { ...SUMMARY, id: "cred-xyz", name: null, lastUsedAt: null, clonedAt: null }],
        pendingRevoke: { id: "cred-abc", isLastPasskey: true },
        renamingId: "cred-xyz",
        draftName: "Work laptop",
        status: "busy",
        error: null,
      },
      {
        passkeys: [SUMMARY],
        pendingRevoke: null,
        renamingId: null,
        draftName: "",
        status: "error",
        error: { code: "unknown_credential", message: "No such credential." },
      },
    ];

    for (const state of states) {
      expect(roundTrip(state)).toEqual(state);
      // `null` is a value here, not an absence — a round-trip that dropped it
      // would change "no pending revoke" into "unknown".
      expect(Object.keys(roundTrip(state)).sort()).toEqual(Object.keys(state).sort());
    }
  });

  it("round-trips an activity event unchanged", () => {
    const event: PasskeyActivityEvent = {
      surface: "passkey-manager",
      action: "revoke-proposed",
      target: "cred-abc",
      at: "2026-07-31T09:15:00.000Z",
      detail: { isLastPasskey: true },
    };

    expect(roundTrip(event)).toEqual(event);
  });
});
