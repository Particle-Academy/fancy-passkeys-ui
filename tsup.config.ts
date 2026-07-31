import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/styles.css"],
  format: ["esm", "cjs"],
  dts: { entry: ["src/index.ts", "src/client.ts"] },
  // Every one of these is a peer. Bundling `@simplewebauthn/browser` would put a
  // second copy of the ceremony code in the consumer's tree; bundling
  // react-fancy would ship a second React component registry. Both look exactly
  // like success right up until they don't.
  external: [
    "react",
    "react-dom",
    "@particle-academy/react-fancy",
    "@simplewebauthn/browser",
    "tailwindcss",
  ],
  treeshake: true,
  clean: true,
  sourcemap: true,
});
