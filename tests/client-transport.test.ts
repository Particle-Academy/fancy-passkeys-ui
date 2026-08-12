import { describe, expect, it } from "vitest";
import { createFetchTransport } from "../src/client";

/**
 * `createFetchTransport` normalises its `baseUrl` by stripping trailing
 * slashes. That one line was a polynomial ReDoS (CodeQL `js/polynomial-redos`,
 * fancy-passkeys-ui #1).
 *
 * `/\/+$/` anchors a greedy run at the end, so on a long run of slashes that is
 * NOT followed by end-of-string the engine restarts the run at every position:
 * quadratic. Measured on the vulnerable version, 30k slashes took ~590ms and
 * the same work without a regex took 0ms — and it scales, so 60k is seconds.
 *
 * The realistic exposure is small: `baseUrl` is usually a developer-supplied
 * constant. It is fixed anyway because "an attacker cannot reach this today" is
 * a property of the call sites, which change, rather than of the function,
 * which is where the flaw is.
 */
describe("baseUrl normalisation", () => {
  const strip = async (baseUrl: string): Promise<string> => {
    // The transport keeps its normalised baseUrl private and calls the GLOBAL
    // fetch, so exercise it the way a consumer would and read the URL back off
    // the request.
    let seen = "";
    const original = globalThis.fetch;

    // The stub has to satisfy what the transport actually reads -- it calls
    // `response.text()`, not `.json()`. An incomplete stub rejects INSIDE the
    // transport, and because the rejection surfaces after the assertion it
    // passes locally and fails on CI as an unhandled rejection.
    globalThis.fetch = (async (url: string) => {
      seen = String(url);
      return { ok: true, status: 200, text: async () => "{}" };
    }) as unknown as typeof fetch;

    try {
      // Awaited, not `void`-ed: a floating promise here is exactly how the
      // above went unnoticed.
      await createFetchTransport({ baseUrl }).post("/x");
    } finally {
      globalThis.fetch = original;
    }

    return seen.slice(0, seen.length - "/x".length);
  };

  it("strips trailing slashes", async () => {
    expect(await strip("/passkeys/")).toBe("/passkeys");
    expect(await strip("/passkeys///")).toBe("/passkeys");
    expect(await strip("/passkeys")).toBe("/passkeys");
    expect(await strip("https://example.com/auth//")).toBe("https://example.com/auth");
  });

  it("collapses a path that is nothing but slashes", async () => {
    expect(await strip("///")).toBe("");
  });

  it("normalises a pathological run of slashes in linear time", async () => {
    // The regression guard. Against the old `/\/+$/` this takes hundreds of
    // milliseconds and grows quadratically; the scanning version is immediate.
    // The threshold is deliberately loose — this must not fail on a slow CI
    // box, only on a return to quadratic behaviour, which is ~2 orders of
    // magnitude away.
    const evil = `/a${"/".repeat(30_000)}x`;

    const started = Date.now();
    const result = await strip(evil);
    const elapsed = Date.now() - started;

    // Not merely fast — still correct. A guard that only timed the call would
    // pass against a function that returned the wrong answer quickly.
    expect(result).toBe(evil);
    expect(elapsed).toBeLessThan(150);
  });
});
