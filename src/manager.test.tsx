import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PasskeyManager, type PasskeyManagerProps, type PasskeyManagerState } from "./PasskeyManager";
import type { PasskeyActivityEvent, PasskeySummary } from "./types";

afterEach(cleanup);

const STATE_KEYS = ["draftName", "error", "passkeys", "pendingRevoke", "renamingId", "status"];

function passkey(overrides: Partial<PasskeySummary> & { id: string }): PasskeySummary {
  return {
    name: null,
    createdAt: "2026-07-01T09:00:00.000Z",
    lastUsedAt: null,
    transports: ["internal"],
    backedUp: true,
    aaguid: "adce0002-35bc-c60a-648b-0b25f1f05503",
    clonedAt: null,
    ...overrides,
  };
}

const LAPTOP = passkey({ id: "cred-laptop", name: "Laptop" });
const PHONE = passkey({ id: "cred-phone", name: "Phone", backedUp: false });

function baseState(passkeys: PasskeySummary[]): PasskeyManagerState {
  return {
    passkeys,
    pendingRevoke: null,
    renamingId: null,
    draftName: "",
    status: "idle",
    error: null,
  };
}

/**
 * A real controlled host: state lives outside the component and every emission
 * round-trips through it, which is the only way to test a staged revoke.
 */
function Harness({
  initial,
  onState,
  ...props
}: { initial: PasskeyManagerState; onState?: (next: PasskeyManagerState) => void } & Omit<
  PasskeyManagerProps,
  "value" | "onChange"
>) {
  const [state, setState] = useState(initial);
  return (
    <PasskeyManager
      {...props}
      value={state}
      onChange={(next) => {
        onState?.(next);
        setState(next);
      }}
    />
  );
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-fancy-passkey-item="${id}"]`);
  if (!element) throw new Error(`No row for credential ${id}`);
  return element;
}

function action(id: string, name: string): HTMLButtonElement {
  const element = row(id).querySelector<HTMLButtonElement>(
    `[data-fancy-passkey-action="${name}"][data-fancy-passkey-id="${id}"]`,
  );
  if (!element) throw new Error(`No ${name} action on credential ${id}`);
  return element;
}

describe("PasskeyManager handles", () => {
  it("keys every row by credential ID, not by list position", () => {
    const { rerender } = render(
      <PasskeyManager value={baseState([LAPTOP, PHONE])} onChange={vi.fn()} />,
    );

    expect(row("cred-laptop").textContent).toContain("Laptop");
    expect(row("cred-phone").textContent).toContain("Phone");

    // Reorder the list. An index-keyed handle would now point at the other
    // passkey, and "revoke the one the agent named" would silently revoke
    // somebody else's device.
    rerender(<PasskeyManager value={baseState([PHONE, LAPTOP])} onChange={vi.fn()} />);

    expect(row("cred-laptop").textContent).toContain("Laptop");
    expect(row("cred-phone").textContent).toContain("Phone");
    expect(action("cred-laptop", "revoke").getAttribute("data-fancy-passkey-id")).toBe(
      "cred-laptop",
    );
  });

  it("carries the surface handle and an empty-state handle", () => {
    const { container } = render(
      <PasskeyManager value={baseState([])} onChange={vi.fn()} surfaceId="account-passkeys" />,
    );

    expect(container.querySelector('[data-fancy-passkey-surface="account-passkeys"]')).not.toBeNull();
    expect(container.querySelector("[data-fancy-passkey-empty]")?.textContent).toBe(
      "No passkeys yet.",
    );
  });
});

describe("PasskeyManager revoke", () => {
  it("stages a revoke instead of performing it, and only confirms on an explicit confirm", async () => {
    const onRevoke = vi.fn();
    render(<Harness initial={baseState([LAPTOP, PHONE])} onRevoke={onRevoke} />);

    fireEvent.click(action("cred-phone", "revoke"));

    // pendingMode defaults to true. Nothing has happened to the credential yet.
    expect(onRevoke).not.toHaveBeenCalled();
    expect(row("cred-phone").querySelector("[data-fancy-passkey-confirm]")).not.toBeNull();

    fireEvent.click(action("cred-phone", "confirm-revoke"));

    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith({ id: "cred-phone" }));
  });

  it("cancelling a staged revoke clears it and never calls onRevoke", () => {
    const onRevoke = vi.fn();
    render(<Harness initial={baseState([LAPTOP, PHONE])} onRevoke={onRevoke} />);

    fireEvent.click(action("cred-phone", "revoke"));
    fireEvent.click(action("cred-phone", "cancel-revoke"));

    expect(onRevoke).not.toHaveBeenCalled();
    expect(document.querySelector("[data-fancy-passkey-confirm]")).toBeNull();
  });

  it("flags the last passkey as a lockout and says so in the confirmation copy", () => {
    const states: PasskeyManagerState[] = [];
    render(<Harness initial={baseState([LAPTOP])} onState={(next) => states.push(next)} />);

    fireEvent.click(action("cred-laptop", "revoke"));

    expect(states[0]!.pendingRevoke).toEqual({ id: "cred-laptop", isLastPasskey: true });
    const confirm = row("cred-laptop").querySelector("[data-fancy-passkey-confirm]")!;
    expect(confirm.getAttribute("data-fancy-passkey-last")).toBe("true");
    // "Are you sure?" has not warned anyone. The copy has to name the lockout.
    expect(confirm.textContent).toMatch(/last passkey/i);
    expect(confirm.textContent).toMatch(/locked out/i);
  });

  it("does not claim a lockout when other passkeys remain", () => {
    const states: PasskeyManagerState[] = [];
    render(<Harness initial={baseState([LAPTOP, PHONE])} onState={(next) => states.push(next)} />);

    fireEvent.click(action("cred-phone", "revoke"));

    expect(states[0]!.pendingRevoke).toEqual({ id: "cred-phone", isLastPasskey: false });
    expect(row("cred-phone").querySelector("[data-fancy-passkey-confirm]")!.textContent).not.toMatch(
      /last passkey/i,
    );
  });

  it("revokes immediately when pendingMode is off", async () => {
    const onRevoke = vi.fn();
    render(<Harness initial={baseState([LAPTOP, PHONE])} onRevoke={onRevoke} pendingMode={false} />);

    fireEvent.click(action("cred-phone", "revoke"));

    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith({ id: "cred-phone" }));
  });

  it("drops the revoked credential from the emitted state", async () => {
    const states: PasskeyManagerState[] = [];
    render(
      <Harness
        initial={baseState([LAPTOP, PHONE])}
        onRevoke={vi.fn()}
        onState={(next) => states.push(next)}
      />,
    );

    fireEvent.click(action("cred-phone", "revoke"));
    fireEvent.click(action("cred-phone", "confirm-revoke"));

    await waitFor(() => expect(document.querySelector('[data-fancy-passkey-item="cred-phone"]')).toBeNull());
    const last = states[states.length - 1]!;
    expect(last.passkeys.map((entry) => entry.id)).toEqual(["cred-laptop"]);
    expect(last.pendingRevoke).toBeNull();
    expect(last.status).toBe("idle");
  });
});

describe("PasskeyManager rename", () => {
  it("edits through the draft and calls onRename with the trimmed name", async () => {
    const onRename = vi.fn();
    render(<Harness initial={baseState([LAPTOP])} onRename={onRename} />);

    fireEvent.click(action("cred-laptop", "rename"));

    const field = row("cred-laptop").querySelector<HTMLInputElement>(
      '[data-fancy-passkey-field="name"]',
    )!;
    expect(field.value).toBe("Laptop");

    fireEvent.change(field, { target: { value: "  Work laptop  " } });
    fireEvent.click(action("cred-laptop", "save-rename"));

    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith({ id: "cred-laptop", name: "Work laptop" }),
    );
    await waitFor(() => expect(row("cred-laptop").textContent).toContain("Work laptop"));
  });

  it("cancelling a rename leaves the name alone", () => {
    const onRename = vi.fn();
    render(<Harness initial={baseState([LAPTOP])} onRename={onRename} />);

    fireEvent.click(action("cred-laptop", "rename"));
    fireEvent.click(action("cred-laptop", "cancel-rename"));

    expect(onRename).not.toHaveBeenCalled();
    expect(row("cred-laptop").textContent).toContain("Laptop");
  });
});

describe("PasskeyManager activity", () => {
  it("emits an event for propose, cancel, confirm and rename", async () => {
    const activity: PasskeyActivityEvent[] = [];
    render(
      <Harness
        initial={baseState([LAPTOP, PHONE])}
        onRevoke={vi.fn()}
        onRename={vi.fn()}
        onActivity={(event) => activity.push(event)}
      />,
    );

    fireEvent.click(action("cred-phone", "revoke"));
    fireEvent.click(action("cred-phone", "cancel-revoke"));
    fireEvent.click(action("cred-phone", "revoke"));
    fireEvent.click(action("cred-phone", "confirm-revoke"));
    await waitFor(() => expect(document.querySelector('[data-fancy-passkey-item="cred-phone"]')).toBeNull());

    fireEvent.click(action("cred-laptop", "rename"));
    fireEvent.click(action("cred-laptop", "save-rename"));
    await waitFor(() => expect(activity).toHaveLength(5));

    expect(activity.map((event) => event.action)).toEqual([
      "revoke-proposed",
      "revoke-cancelled",
      "revoke-proposed",
      "revoke-confirmed",
      "rename",
    ]);
    expect(activity.every((event) => event.surface === "passkey-manager")).toBe(true);
    expect(activity.map((event) => event.target)).toEqual([
      "cred-phone",
      "cred-phone",
      "cred-phone",
      "cred-phone",
      "cred-laptop",
    ]);
    expect(activity[0]!.detail).toEqual({ isLastPasskey: false });
    expect(new Date(activity[0]!.at).toISOString()).toBe(activity[0]!.at);
  });

  it("emits enroll when enrollment is started", async () => {
    const activity: PasskeyActivityEvent[] = [];
    const onEnroll = vi.fn();
    render(
      <Harness
        initial={baseState([])}
        onEnroll={onEnroll}
        onActivity={(event) => activity.push(event)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add a passkey/i }));

    await waitFor(() => expect(onEnroll).toHaveBeenCalledTimes(1));
    expect(activity.map((event) => event.action)).toEqual(["enroll"]);
  });

  it("emits the FULL next state on every change", () => {
    const states: PasskeyManagerState[] = [];
    render(<Harness initial={baseState([LAPTOP])} onState={(next) => states.push(next)} />);

    fireEvent.click(action("cred-laptop", "revoke"));

    expect(states).toHaveLength(1);
    expect(Object.keys(states[0]!).sort()).toEqual(STATE_KEYS);
  });
});

describe("PasskeyManager credential detail", () => {
  it("surfaces a clone flag as a security event, not a footnote", () => {
    const cloned = passkey({ id: "cred-cloned", name: "Yubikey", clonedAt: "2026-07-28T12:00:00.000Z" });
    render(<PasskeyManager value={baseState([cloned])} onChange={vi.fn()} />);

    const banner = row("cred-cloned").querySelector('[data-fancy-passkey-cloned="cred-cloned"]')!;
    expect(banner).not.toBeNull();
    // Announced, not buried in the metadata line.
    expect(banner.querySelector('[role="alert"]')).not.toBeNull();
    expect(banner.textContent).toMatch(/clone detected/i);
    expect(banner.textContent).toContain("2026-07-28");
  });

  it("distinguishes a synced passkey from a device-bound one", () => {
    render(<PasskeyManager value={baseState([LAPTOP, PHONE])} onChange={vi.fn()} />);

    expect(row("cred-laptop").textContent).toContain("Synced");
    expect(row("cred-phone").textContent).toContain("This device only");
  });

  it("renders an error as an alert", () => {
    render(
      <PasskeyManager
        value={{
          ...baseState([LAPTOP]),
          status: "error",
          error: { code: "unknown_credential", message: "That passkey is gone." },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("That passkey is gone.");
  });
});
