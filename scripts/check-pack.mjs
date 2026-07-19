import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm so npm_execpath is available.");
const result = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: packageDir,
  encoding: "utf8",
  windowsHide: true
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
const report = JSON.parse(result.stdout);
const files = (report[0]?.files || []).map((entry) => entry.path).sort();
const expected = ["LICENSE", "README.md", "bin/deeppane-mcp.js", "package.json", "server.json"].sort();
const forbidden = files.filter((file) => /(^|\/)(?:\.dev\.vars|\.env|docs|scripts|test|tests|fixtures|media|logs?)(?:\/|$)/i.test(file));
const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const listedFiles = [...(manifest.files || [])].sort();
const expectedManifestFiles = ["LICENSE", "README.md", "bin/deeppane-mcp.js", "server.json"].sort();
const exactTarball = JSON.stringify(files) === JSON.stringify(expected);
const exactManifest = JSON.stringify(listedFiles) === JSON.stringify(expectedManifestFiles);
if (!exactTarball || !exactManifest || forbidden.length) {
  console.error(JSON.stringify({ exactTarball, exactManifest, files, listedFiles, forbidden }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, files, unpackedSize: report[0]?.unpackedSize, packageSize: report[0]?.size }, null, 2));
