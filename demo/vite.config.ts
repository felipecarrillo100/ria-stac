import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import react from "@vitejs/plugin-react";
import {defineConfig} from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..");

// The STAC explorer: React + MUI around a LuciadRIA map. It imports ria-stac from its sources (src/), so every
// change to the library shows at once. LuciadRIA is a dev dependency of the demo only: ria-stac does not use it.
export default defineConfig({
    root: here,
    plugins: [react()],
    resolve: {alias: {"ria-stac": resolve(repo, "src/index.ts")}, dedupe: ["@luciad/ria", "react", "react-dom"]},
    server: {port: 5310, strictPort: true, fs: {allow: [repo]}},
    // Local fixtures (a static catalog) for offline tries.
    publicDir: resolve(here, "public"),
    build: {outDir: resolve(here, "dist"), target: "es2022"},
    esbuild: {target: "es2022"},
    optimizeDeps: {esbuildOptions: {target: "es2022"}},
});
