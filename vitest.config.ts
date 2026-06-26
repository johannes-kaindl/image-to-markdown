import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    // pool: "forks" (separate Prozesse) statt des 1.6-Defaults "threads": seit der
    // obsidian-Mock auf obsidian-kit/testing re-exportiert, läuft Nodes nativer
    // CJS-Preparser (cjsPreparseModuleExports) in den Worker-Threads. Dessen
    // Module-Lexer ist unter worker_threads-Nebenläufigkeit nicht sicher → ~15%
    // intermittierender V8-FATAL "ToLocalChecked Empty MaybeLocal" (SIGABRT). Forks
    // isolieren das pro Prozess (= vitest-2.0-Default). Empirisch: threads 4/30,
    // forks 0/30 Crashes.
    pool: "forks",
  },
  resolve: { alias: { obsidian: path.resolve(__dirname, "./tests/__mocks__/obsidian.ts") } },
});
