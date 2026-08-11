import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIRECTORY = join(SERVER_ROOT, "test");
const MOCHA_PATH = join(SERVER_ROOT, "node_modules", "mocha", "bin", "mocha.js");
const forwardedArguments = process.argv.slice(2);
const testFiles = readdirSync(TEST_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => join(TEST_DIRECTORY, entry.name))
  .sort();
const failures = [];

if (testFiles.length === 0) {
  throw new Error(`No test files were found in ${TEST_DIRECTORY}.`);
}

for (const testFile of testFiles) {
  const displayPath = relative(SERVER_ROOT, testFile);

  console.log(`\n[Grandoria tests] ${displayPath}`);

  const result = spawnSync(
    process.execPath,
    [
      MOCHA_PATH,
      "-r",
      "tsx",
      "--exit",
      "--timeout",
      "15000",
      testFile,
      ...forwardedArguments,
    ],
    {
      cwd: SERVER_ROOT,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    failures.push(displayPath);
  }
}

if (failures.length > 0) {
  console.error(`\nFailed test files:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${testFiles.length} test files passed in isolated processes.`);
}
