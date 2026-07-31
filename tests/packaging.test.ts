import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The promises this package makes about what it drags into a consumer's tree,
 * and about the entry split that the whole `-ui` / `-js` design rests on.
 *
 * `npm test` runs `tsup` first (see the `pretest` script) precisely so the
 * `dist/client.js` assertions below are real rather than aspirational. A
 * packaging test that skips when the build is missing is a packaging test that
 * never runs in the one situation it exists for.
 *
 * Lives in `tests/` rather than `src/` so `tsc --noEmit` (which compiles `src`)
 * does not need `@types/node` on the runtime type graph.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  exports: Record<string, unknown>;
};
const tsupConfig = readFileSync(join(root, "tsup.config.ts"), "utf8");

const PEERS = [
  "react",
  "react-dom",
  "@particle-academy/react-fancy",
  "@simplewebauthn/browser",
  "tailwindcss",
];

function readDist(file: string): string {
  const path = join(root, "dist", file);
  if (!existsSync(path)) {
    throw new Error(
      `dist/${file} is missing. Run \`npm run build\` (or \`npm test\`, which builds first) before asserting on the bundle.`,
    );
  }
  return readFileSync(path, "utf8");
}

/**
 * The ESM build code-splits: `dist/client.js` is a two-line re-export of a
 * shared chunk, and the actual ceremony lives in the chunk. That sharing is
 * deliberate — it is what keeps ONE `PasskeyCeremonyError` class in the package
 * so `instanceof` holds whether a consumer imported from the root or from
 * `./client` — but it means reading only the entry file would assert nothing.
 * So follow the relative imports and assert over everything the entry reaches.
 */
function readEntryGraph(entry: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readDist(file);
    parts.push(source);

    for (const match of source.matchAll(/["'](\.\/[^"']+\.(?:js|cjs|mjs))["']/g)) {
      queue.push(match[1]!.slice(2));
    }
  }

  return parts.join("\n");
}

describe("dependency contract", () => {
  it("declares no runtime dependencies at all", () => {
    // Empty and staying empty. Every one of these libraries is something a host
    // may already have, and a second copy in the tree is how you get two
    // incompatible credential types or a resolver quietly picking an old one.
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it.each(PEERS)("keeps %s as a peer dependency", (name) => {
    expect(pkg.peerDependencies[name]).toBeDefined();
  });

  it.each(PEERS)("marks %s external in the tsup build", (name) => {
    const external = /external:\s*\[([^\]]*)\]/s.exec(tsupConfig)?.[1];
    expect(external, "tsup.config.ts has no `external` array").toBeDefined();
    expect(external).toContain(`"${name}"`);
  });

  it("never caps a first-party sibling with a caret on a 0.x", () => {
    // A caret on a 0.x locks the MINOR, so every sibling release after the line
    // was written reads to the resolver as a conflict rather than an upgrade —
    // and nothing ever reports it.
    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      if (!name.startsWith("@particle-academy/")) continue;
      expect(range.startsWith("^0."), `${name} is capped with a caret on a 0.x`).toBe(false);
    }
  });
});

describe("entry split", () => {
  it("publishes both entries plus the stylesheet", () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./client", "./styles.css"]);
  });

  it.each(["client.js", "client.cjs"])("keeps React out of everything %s reaches", (file) => {
    const source = readEntryGraph(file);

    // If this fails, something moved into the wrong entry. That is the bug —
    // not the test. `./client` is imported by Vue, Svelte and vanilla frontends
    // that have no business installing React to run a WebAuthn ceremony.
    expect(source).not.toMatch(/from\s*["']react["']/);
    expect(source).not.toMatch(/from\s*["']react-dom["']/);
    expect(source).not.toMatch(/require\(\s*["']react(-dom)?["']\s*\)/);
    expect(source).not.toMatch(/react\/jsx-runtime/);
    expect(source).not.toMatch(/@particle-academy\/react-fancy/);
  });

  it("proves the React entry DOES pull React, so the check above means something", () => {
    // A "no react import" assertion is worthless if nothing in the package
    // imports React in the first place.
    expect(readEntryGraph("index.js")).toMatch(/from\s*["']react["']/);
  });

  it.each(["client.js", "client.cjs"])(
    "keeps the ceremony library external in %s rather than inlining it",
    (file) => {
      expect(readEntryGraph(file)).toMatch(/["']@simplewebauthn\/browser["']/);
    },
  );

  it("still exports the ceremony from the React entry", () => {
    const source = readEntryGraph("index.js");
    expect(source).toMatch(/registerPasskey/);
    expect(source).toMatch(/authenticateWithPasskey/);
  });

  it("ships type declarations for both entries", () => {
    for (const file of ["index.d.ts", "index.d.cts", "client.d.ts", "client.d.cts"]) {
      expect(existsSync(join(root, "dist", file)), `dist/${file} is missing`).toBe(true);
    }
  });
});
