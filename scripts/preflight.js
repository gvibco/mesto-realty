import { spawnSync } from "node:child_process";

// Fast, deterministic gate before pushing: unit tests, formatting, dependency
// audit, whitespace errors and junk accidentally staged in the repository.
const steps = [
  ["unit tests", "npm test"],
  ["formatting", "npm run format:check"],
  ["dependency audit", "npm audit --omit=dev"],
  [
    "diff whitespace",
    "git diff --check && git diff --cached --check && git log --check -1",
  ],
];

let failed = 0;
for (const [name, command] of steps) {
  process.stdout.write(`\n== ${name} ==\n`);
  const result = spawnSync(command, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAILED: ${name}`);
  }
}

const junk = spawnSync("git", ["ls-files"], { encoding: "utf8" });
const tracked = (junk.stdout || "")
  .split(/\r?\n/)
  .filter(
    (file) =>
      file && /(__pycache__|(^|\/)\.env$|(^|\/)(output|uploads)\/)/.test(file),
  );
if (tracked.length) {
  failed += 1;
  console.error(`FAILED: junk tracked in git: ${tracked.join(", ")}`);
}

if (failed) {
  console.error(`\npreflight: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\npreflight: all checks passed");
