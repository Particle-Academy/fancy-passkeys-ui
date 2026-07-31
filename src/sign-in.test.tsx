import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PasskeySignIn, type PasskeySignInState } from "./PasskeySignIn";
import { PasskeyServerError } from "./client";
import type { PasskeyActivityEvent } from "./types";

afterEach(cleanup);

const IDLE: PasskeySignInState = { status: "idle", email: "", error: null };

/** Every key the state contract promises. Asserted, not assumed. */
const STATE_KEYS = ["email", "error", "status"];

describe("PasskeySignIn", () => {
  it("renders the discoverable flow as a button with no username field", () => {
    const { container } = render(
      <PasskeySignIn value={IDLE} onChange={vi.fn()} onAuthenticate={vi.fn()} />,
    );

    expect(container.querySelector('[data-fancy-passkey-surface="passkey-sign-in"]')).not.toBeNull();
    expect(container.querySelector('[data-fancy-passkey-action="authenticate"]')).not.toBeNull();
    // The usernameless flow is the one the plan optimises for — and the one
    // with nothing to enumerate. No email input belongs here.
    expect(container.querySelector('[data-fancy-passkey-field="email"]')).toBeNull();
    expect(screen.getByRole("button").textContent).toContain("Sign in with a passkey");
  });

  it("honours a custom surfaceId on the root handle", () => {
    const { container } = render(
      <PasskeySignIn
        value={IDLE}
        onChange={vi.fn()}
        onAuthenticate={vi.fn()}
        surfaceId="login-passkey"
      />,
    );

    expect(container.querySelector('[data-fancy-passkey-surface="login-passkey"]')).not.toBeNull();
  });

  it("calls onAuthenticate when the button is pressed", async () => {
    const onAuthenticate = vi.fn();
    render(<PasskeySignIn value={IDLE} onChange={vi.fn()} onAuthenticate={onAuthenticate} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(onAuthenticate).toHaveBeenCalledTimes(1));
    expect(onAuthenticate).toHaveBeenCalledWith({});
  });

  it("passes the email through in mode=email", async () => {
    const onAuthenticate = vi.fn();
    render(
      <PasskeySignIn
        value={{ ...IDLE, email: "ada@example.test" }}
        onChange={vi.fn()}
        onAuthenticate={onAuthenticate}
        mode="email"
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(onAuthenticate).toHaveBeenCalledWith({ email: "ada@example.test" }),
    );
  });

  it("emits the FULL next state on every change, never a slice", async () => {
    const onChange = vi.fn();
    render(<PasskeySignIn value={IDLE} onChange={onChange} onAuthenticate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    for (const [next] of onChange.mock.calls as Array<[PasskeySignInState]>) {
      // A host that has to merge slices to know what the surface shows is a host
      // an agent cannot read back from.
      expect(Object.keys(next).sort()).toEqual(STATE_KEYS);
    }
    expect(onChange.mock.calls[0]![0]).toEqual({ status: "prompting", email: "", error: null });
    expect(onChange.mock.calls[1]![0]).toEqual({ status: "success", email: "", error: null });
  });

  it("emits the full state when the email field is typed into", () => {
    const onChange = vi.fn();
    const { container } = render(
      <PasskeySignIn value={IDLE} onChange={onChange} onAuthenticate={vi.fn()} mode="email" />,
    );

    const input = container.querySelector<HTMLInputElement>('[data-fancy-passkey-field="email"]')!;
    fireEvent.change(input, { target: { value: "ada@example.test" } });

    expect(onChange).toHaveBeenCalledWith({
      status: "idle",
      email: "ada@example.test",
      error: null,
    });
  });

  it("renders a cancelled ceremony quietly — never as an error", () => {
    const { container } = render(
      <PasskeySignIn
        value={{ ...IDLE, status: "cancelled" }}
        onChange={vi.fn()}
        onAuthenticate={vi.fn()}
      />,
    );

    // Reporting an abandoned prompt as a failure trains users to distrust the
    // surface. It gets a muted hint and nothing louder.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector('[data-fancy-passkey-hint="cancelled"]')).not.toBeNull();
  });

  it("renders a real failure as an alert", () => {
    render(
      <PasskeySignIn
        value={{ ...IDLE, status: "error", error: { code: "verification_failed", message: "No." } }}
        onChange={vi.fn()}
        onAuthenticate={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("No.");
  });

  it("disables the button and explains itself when unsupported", () => {
    const { container } = render(
      <PasskeySignIn
        value={{ ...IDLE, status: "unsupported" }}
        onChange={vi.fn()}
        onAuthenticate={vi.fn()}
      />,
    );

    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-fancy-passkey-hint="unsupported"]')?.textContent).toMatch(
      /can't use passkeys/i,
    );
  });

  it("does not run the ceremony while unsupported", async () => {
    const onAuthenticate = vi.fn();
    const onChange = vi.fn();
    render(
      <PasskeySignIn
        value={{ ...IDLE, status: "unsupported" }}
        onChange={onChange}
        onAuthenticate={onAuthenticate}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(onAuthenticate).not.toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tags the input for conditional UI only when conditional is set", () => {
    const { container, rerender } = render(
      <PasskeySignIn value={IDLE} onChange={vi.fn()} onAuthenticate={vi.fn()} mode="email" />,
    );

    const field = () => container.querySelector('[data-fancy-passkey-field="email"]')!;
    expect(field().getAttribute("autocomplete")).toBe("username");

    rerender(
      <PasskeySignIn
        value={IDLE}
        onChange={vi.fn()}
        onAuthenticate={vi.fn()}
        mode="email"
        conditional
      />,
    );

    // The `webauthn` token is what makes the browser offer a passkey from
    // inside the field; without it, conditional UI silently does nothing.
    expect(field().getAttribute("autocomplete")).toBe("username webauthn");
  });

  it("turns a dismissed prompt into status:cancelled and a cancelled activity event", async () => {
    const onChange = vi.fn();
    const activity: PasskeyActivityEvent[] = [];
    render(
      <PasskeySignIn
        value={IDLE}
        onChange={onChange}
        onActivity={(event) => activity.push(event)}
        onAuthenticate={() => Promise.reject(new DOMException("dismissed", "NotAllowedError"))}
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange.mock.calls[1]![0]).toEqual({ status: "cancelled", email: "", error: null });
    expect(activity.map((event) => event.action)).toEqual(["authenticate", "cancelled"]);
    expect(activity[0]!.surface).toBe("passkey-sign-in");
    expect(typeof activity[0]!.at).toBe("string");
  });

  it("keeps a server error code intact in state", async () => {
    const onChange = vi.fn();
    const activity: PasskeyActivityEvent[] = [];
    render(
      <PasskeySignIn
        value={IDLE}
        onChange={onChange}
        onActivity={(event) => activity.push(event)}
        onAuthenticate={() =>
          Promise.reject(new PasskeyServerError("counter_regressed", "Counter regressed."))
        }
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange.mock.calls[1]![0]).toEqual({
      status: "error",
      email: "",
      error: { code: "counter_regressed", message: "Counter regressed." },
    });
    expect(activity.map((event) => event.action)).toEqual(["authenticate", "error"]);
  });
});
