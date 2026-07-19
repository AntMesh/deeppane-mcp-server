import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeScript = path.join(packageDir, "scripts", "smoke-stdio.mjs");
const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm so npm_execpath is available.");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "deeppane-mcp-clean-install-"));
let tarballPath = "";
try {
  const pack = runNpm(["pack", "--json", "--ignore-scripts"], packageDir);
  const packReport = JSON.parse(pack.stdout);
  tarballPath = path.join(packageDir, packReport[0].filename);
  await writeFile(path.join(tempDir, "package.json"), JSON.stringify({ private: true }, null, 2) + "\n", "utf8");
  runNpm(["install", tarballPath, "--ignore-scripts", "--no-audit", "--no-fund"], tempDir);

  const smoke = spawnSync(process.execPath, [smokeScript], {
    cwd: packageDir,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      DEEPPANE_MCP_SERVER_COMMAND: process.execPath,
      DEEPPANE_MCP_SERVER_ARGS: JSON.stringify([npmCli, "exec", "--offline", "--", "deeppane-mcp"]),
      DEEPPANE_MCP_SERVER_CWD: tempDir,
      DEEPPANE_MCP_EXPECTED_VERSION: packageJson.version
    }
  });
  if (smoke.status !== 0) {
    process.stderr.write(smoke.stderr || smoke.stdout);
    process.exitCode = smoke.status || 1;
  } else {
    const protocolReport = JSON.parse(smoke.stdout);
    console.log(JSON.stringify({
      ok: true,
      package: packageJson.name,
      version: packageJson.version,
      installRoot: tempDir,
      protocolChecks: protocolReport.checked.length,
      stderrClean: protocolReport.stderr === ""
    }, null, 2));
  }
} finally {
  if (tarballPath) await rm(tarballPath, { force: true });
  await rm(tempDir, { recursive: true, force: true });
}

function runNpm(args, cwd) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  return result;
}
