import {defineConfig} from "vitest/config";

// Spikes: live measurements against public catalogs, run on demand (npx vitest run --config spikes/vitest.config.ts).
export default defineConfig({test: {include: ["spikes/**/*.spike.ts"], testTimeout: 900_000}});
