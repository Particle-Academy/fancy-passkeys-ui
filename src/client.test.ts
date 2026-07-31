import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import {
  authenticateWithPasskey,
  createFetchTransport,
  isPasskeySupported,
  normalizeCeremonyError,
  PasskeyCeremonyError,
  PasskeyServerError,
  registerPasskey,
  type PasskeySummary,
  type PasskeyTransport,
} from "./client";

// The WebAuthn API is stubbed, never called for real. There is no authenticator
// in CI, and a test that needs one is a test that never runs.
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  platformAuthenticatorIsAvailable: vi.fn(async () => true),
  browserSupportsWebAuthnAutofill: vi.fn(async () => true),
  WebAuthnAbortService: { cancelCeremony: vi.fn(), createNewAbortSignal: vi.fn() },
}));

const startRegistrationMock = vi.mocked(startRegistration);
const startAuthenticationMock = vi.mocked(startAuthentication);

const SUMMARY: PasskeySummary = {
  id: "cred-abc",
  name: "MacBook Touch ID",
  createdAt: "2026-07-30T10:00:00.000Z",
  lastUsedAt: null,
  transports: ["internal", "hybrid"],
  backedUp: true,
  aaguid: "adce0002-35bc-c60a-648b-0b25f1f05503",
  clonedAt: null,
};

function enableWebAuthn(): void {
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    value: function PublicKeyCredential() {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "credentials", {
    value: { create: () => Promise.resolve(null), get: () => Promise.resolve(null) },
    configurable: true,
  });
}

function disableWebAuthn(): void {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "PublicKeyCredential");
  Object.defineProperty(navigator, "credentials", { value: undefined, configurable: true });
}

/** Await a rejection and type it, failing loudly if the promise resolves instead. */
async function rejection<T>(promise: Promise<unknown>): Promise<T> {
  try {
    await promise;
  } catch (err) {
    return err as T;
  }
  throw new Error("Expected the promise to reject, but it resolved.");
}

/** Records every `post` so the wire contract can be asserted call by call. */
function recordingTransport(responses: unknown[]): {
  transport: PasskeyTransport;
  calls: Array<[string, unknown]>;
} {
  const calls: Array<[string, unknown]> = [];
  const queue = [...responses];
  return {
    calls,
    transport: {
      post(path, body) {
        calls.push([path, body]);
        const next = queue.shift();
        if (next instanceof Error) return Promise.reject(next);
        return Promise.resolve(next);
      },
    },
  };
}

beforeEach(() => {
  enableWebAuthn();
});

afterEach(() => {
  disableWebAuthn();
});

describe("normalizeCeremonyError", () => {
  it.each([
    ["NotAllowedError", "cancelled"],
    ["AbortError", "cancelled"],
    ["InvalidStateError", "already_registered"],
    ["SecurityError", "security_error"],
    ["NotSupportedError", "not_supported"],
    ["UnknownError", "ceremony_failed"],
    ["ConstraintError", "ceremony_failed"],
  ])("maps a DOMException named %s to %s", (name, code) => {
    const normalized = normalizeCeremonyError(new DOMException("boom", name));
    expect(normalized).toBeInstanceOf(PasskeyCeremonyError);
    expect(normalized.code).toBe(code);
  });

  it("treats a dismissed prompt as cancelled, not as a failure", () => {
    // The single most load-bearing row in the table: a login surface that
    // reports abandonment as an error trains people to distrust it.
    expect(normalizeCeremonyError(new DOMException("nope", "NotAllowedError")).code).toBe(
      "cancelled",
    );
  });

  it("maps a WebAuthnError through its underlying cause", () => {
    // `@simplewebauthn/browser` sets `name = cause.name`, but the cause chain is
    // checked too so a wrapper that does not is still classified correctly.
    const cause = new DOMException("dismissed", "NotAllowedError");
    const wrapped = Object.assign(new Error("Ceremony aborted"), {
      name: "WebAuthnError",
      code: "ERROR_CEREMONY_ABORTED",
      cause,
    });
    expect(normalizeCeremonyError(wrapped).code).toBe("cancelled");
  });

  it("falls back to ceremony_failed for anything unrecognised", () => {
    const normalized = normalizeCeremonyError(new Error("kaboom"));
    expect(normalized.code).toBe("ceremony_failed");
    expect(normalized.message).toBe("kaboom");
  });

  it("returns an existing PasskeyCeremonyError untouched", () => {
    const original = new PasskeyCeremonyError("cancelled", "already typed");
    expect(normalizeCeremonyError(original)).toBe(original);
  });

  it("never flattens a server code", () => {
    const server = new PasskeyServerError("counter_regressed", "Counter went backwards.");
    const normalized = normalizeCeremonyError(server);
    expect(normalized).toBe(server);
    expect((normalized as PasskeyServerError).serverCode).toBe("counter_regressed");
  });
});

describe("isPasskeySupported", () => {
  it("is false when navigator.credentials is absent", () => {
    disableWebAuthn();
    expect(isPasskeySupported()).toBe(false);
  });

  it("is false when navigator.credentials exists but PublicKeyCredential does not", () => {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "PublicKeyCredential");
    expect(isPasskeySupported()).toBe(false);
  });

  it("is true when the browser exposes both", () => {
    expect(isPasskeySupported()).toBe(true);
  });
});

describe("registerPasskey", () => {
  it("drives the two-round-trip wire contract and round-trips `state`", async () => {
    const publicKey = { challenge: "chal-1", rp: { id: "example.test", name: "Example" } };
    const response = { id: "cred-abc", rawId: "cred-abc", type: "public-key" };
    startRegistrationMock.mockResolvedValue(response as never);

    const { transport, calls } = recordingTransport([
      { state: "state-token-1", publicKey },
      { credential: SUMMARY },
    ]);

    const result = await registerPasskey(transport, { name: "MacBook Touch ID" });

    expect(calls[0]).toEqual(["/register/options", undefined]);
    expect(startRegistrationMock).toHaveBeenCalledWith({ optionsJSON: publicKey });
    expect(calls[1]).toEqual([
      "/register",
      { state: "state-token-1", name: "MacBook Touch ID", response },
    ]);
    expect(result).toEqual({ credential: SUMMARY });
  });

  it("omits `name` entirely when none was given", async () => {
    startRegistrationMock.mockResolvedValue({ id: "cred-abc" } as never);
    const { transport, calls } = recordingTransport([
      { state: "s", publicKey: {} },
      { credential: SUMMARY },
    ]);

    await registerPasskey(transport);

    expect(Object.keys(calls[1]![1] as object).sort()).toEqual(["response", "state"]);
  });

  it("surfaces InvalidStateError as already_registered and never posts the finish", async () => {
    startRegistrationMock.mockRejectedValue(new DOMException("dup", "InvalidStateError"));
    const { transport, calls } = recordingTransport([{ state: "s", publicKey: {} }]);

    await expect(registerPasskey(transport)).rejects.toMatchObject({
      code: "already_registered",
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses to start when the browser cannot do WebAuthn", async () => {
    disableWebAuthn();
    const { transport, calls } = recordingTransport([]);

    await expect(registerPasskey(transport)).rejects.toMatchObject({ code: "not_supported" });
    expect(calls).toHaveLength(0);
  });
});

describe("authenticateWithPasskey", () => {
  it("drives the discoverable flow with no username at all", async () => {
    const publicKey = { challenge: "chal-2", rpId: "example.test" };
    const response = { id: "cred-abc", type: "public-key" };
    startAuthenticationMock.mockResolvedValue(response as never);

    const { transport, calls } = recordingTransport([
      { state: "state-token-2", publicKey },
      { user: { id: 7 }, credential: SUMMARY },
    ]);

    const result = await authenticateWithPasskey(transport);

    expect(calls[0]).toEqual(["/login/options", undefined]);
    expect(startAuthenticationMock).toHaveBeenCalledWith({
      optionsJSON: publicKey,
      useBrowserAutofill: false,
    });
    expect(calls[1]).toEqual(["/login", { state: "state-token-2", response }]);
    expect(result).toEqual({ user: { id: 7 }, credential: SUMMARY });
  });

  it("sends the email for the username-first flow", async () => {
    startAuthenticationMock.mockResolvedValue({ id: "cred-abc" } as never);
    const { transport, calls } = recordingTransport([
      { state: "s", publicKey: {} },
      { user: null, credential: SUMMARY },
    ]);

    await authenticateWithPasskey(transport, { email: "ada@example.test" });

    expect(calls[0]).toEqual(["/login/options", { email: "ada@example.test" }]);
  });

  it("opts into browser autofill when conditional", async () => {
    startAuthenticationMock.mockResolvedValue({ id: "cred-abc" } as never);
    const { transport } = recordingTransport([
      { state: "s", publicKey: { challenge: "c" } },
      { user: null, credential: SUMMARY },
    ]);

    await authenticateWithPasskey(transport, { conditional: true });

    expect(startAuthenticationMock).toHaveBeenCalledWith({
      optionsJSON: { challenge: "c" },
      useBrowserAutofill: true,
    });
  });

  it("reports a dismissed prompt as cancelled and never posts the finish", async () => {
    startAuthenticationMock.mockRejectedValue(new DOMException("dismissed", "NotAllowedError"));
    const { transport, calls } = recordingTransport([{ state: "s", publicKey: {} }]);

    await expect(authenticateWithPasskey(transport)).rejects.toMatchObject({ code: "cancelled" });
    expect(calls).toHaveLength(1);
  });

  it("settles as cancelled when the host aborts before the ceremony", async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport, calls } = recordingTransport([]);

    await expect(
      authenticateWithPasskey(transport, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(calls).toHaveLength(0);
  });

  it("lets a server error code reach the caller instead of flattening it", async () => {
    startAuthenticationMock.mockResolvedValue({ id: "cred-abc" } as never);
    const { transport } = recordingTransport([
      { state: "s", publicKey: {} },
      new PasskeyServerError("counter_regressed", "Response counter regressed."),
    ]);

    const failure = await rejection<PasskeyServerError>(authenticateWithPasskey(transport));

    expect(failure).toBeInstanceOf(PasskeyServerError);
    expect(failure.serverCode).toBe("counter_regressed");
    expect(failure.message).toBe("Response counter regressed.");
  });
});

describe("createFetchTransport", () => {
  function stubFetch(response: Response): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("POSTs JSON to the prefixed path with same-origin credentials", async () => {
    const fetchMock = stubFetch(jsonResponse({ state: "s", publicKey: {} }));
    const transport = createFetchTransport();

    const payload = await transport.post("/login/options", { email: "ada@example.test" });

    expect(payload).toEqual({ state: "s", publicKey: {} });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/passkeys/login/options");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ email: "ada@example.test" }));
  });

  it("honours a custom prefix and sends no body when there is none", async () => {
    const fetchMock = stubFetch(jsonResponse({ state: "s", publicKey: {} }));

    await createFetchTransport({ baseUrl: "/auth/passkeys/" }).post("/register/options");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/auth/passkeys/register/options");
    expect(init.body).toBeUndefined();
  });

  it("sends the Laravel CSRF headers when a token is supplied", async () => {
    const fetchMock = stubFetch(jsonResponse({}));

    await createFetchTransport({ csrfToken: () => "tok-123" }).post("/login");

    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(headers["X-CSRF-TOKEN"]).toBe("tok-123");
    expect(headers["X-XSRF-TOKEN"]).toBe("tok-123");
  });

  it("turns a wire-contract error body into a PasskeyServerError carrying the server's code", async () => {
    stubFetch(
      jsonResponse({ error: { code: "challenge_expired", message: "That took too long." } }, 422),
    );

    const failure = await rejection<PasskeyServerError>(createFetchTransport().post("/login"));

    expect(failure).toBeInstanceOf(PasskeyServerError);
    expect(failure.serverCode).toBe("challenge_expired");
    expect(failure.message).toBe("That took too long.");
    expect(failure.status).toBe(422);
    // Still classified for a UI that only knows the ceremony codes…
    expect(failure.code).toBe("ceremony_failed");
  });

  it("classifies credential_already_registered without losing the server code", async () => {
    stubFetch(
      jsonResponse(
        { error: { code: "credential_already_registered", message: "Already enrolled." } },
        409,
      ),
    );

    const failure = await rejection<PasskeyServerError>(createFetchTransport().post("/register"));

    expect(failure.code).toBe("already_registered");
    expect(failure.serverCode).toBe("credential_already_registered");
  });

  it("still fails typed when the body is not the wire contract", async () => {
    stubFetch(new Response("<html>502</html>", { status: 502 }));

    const failure = await rejection<PasskeyCeremonyError>(createFetchTransport().post("/login"));

    expect(failure).toBeInstanceOf(PasskeyCeremonyError);
    expect(failure.code).toBe("ceremony_failed");
    expect(failure.status).toBe(502);
  });
});
