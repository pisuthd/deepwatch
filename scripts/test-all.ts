/**
 * Run all three smoke tests in sequence and report a summary.
 *
 *   npx tsx scripts/test-all.ts
 *
 * Exits non-zero if any test fails. Useful as a single command to confirm
 * your machine can reach all three upstream APIs.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tests = ["test-polymarket", "test-kalshi", "test-deepbook"] as const;

async function runOne(name: string): Promise<{ name: string; ok: boolean; ms: number }> {
  const scriptPath = join(__dirname, `${name}.ts`);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", scriptPath], {
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      resolve({ name, ok: code === 0, ms: Date.now() - t0 });
    });
  });
}

async function main() {
  console.log("=== smoke test all platforms ===\n");
  const results: Array<{ name: string; ok: boolean; ms: number }> = [];
  for (const name of tests) {
    console.log(`\n--- ${name} ---`);
    results.push(await runOne(name));
  }

  console.log("\n=== summary ===");
  for (const r of results) {
    const tag = r.ok ? "OK  " : "FAIL";
    console.log(`  [${tag}] ${r.name.padEnd(20)} ${r.ms}ms`);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.log(`\n${failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log(`\nall ${results.length} tests passed`);
  }
}

main();
