import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.DEEPPANE_MCP_NETWORK_SMOKE !== "1") {
  throw new Error("Set DEEPPANE_MCP_NETWORK_SMOKE=1 to permit the controlled production call.");
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const serverPath = path.join(packageDir, "bin", "deeppane-mcp.js");
const idempotencyKey = process.env.DEEPPANE_MCP_SMOKE_IDEMPOTENCY_KEY || "deeppane-mcp-" + packageJson.version + "-production-smoke-2026-07-19";
const child = spawn(process.execPath, [serverPath], {
  cwd: packageDir,
  env: { ...process.env, DEEPPANE_API_BASE_URL: "https://api.deeppane.com", DEEPPANE_AGENT_KEY: "" },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});

let nextId = 1;
let buffer = "";
let stderr = "";
const pending = new Map();
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); waiter.resolve(message); }
  }
});

try {
  const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "deeppane-public-package-production-smoke", version: packageJson.version } });
  assert(initialized.result?.serverInfo?.version === packageJson.version, "initialize version mismatch");
  notify("notifications/initialized", {});
  const args = {
    intent: "coding",
    idempotencyKey,
    operationId: "public-package-production-smoke",
    timer: { focusMinutes: 25, breakMinutes: 5 },
    quote: { mode: "catalog" },
    attribution: { source: "mcp-package-smoke", agentRunId: idempotencyKey }
  };
  const first = await request("tools/call", { name: "deeppane.create_focus_space", arguments: args });
  const second = await request("tools/call", { name: "deeppane.create_focus_space", arguments: args });
  const firstData = first.result?.structuredContent;
  const secondData = second.result?.structuredContent;
  assert(firstData?.ok === true, "first production create failed");
  assert(secondData?.ok === true, "idempotent retry failed");
  assert(firstData?.payload?.shareId && firstData.payload.shareId === secondData?.payload?.shareId, "idempotent retry returned a different shareId");
  const shareUrl = new URL(firstData.payload.shareUrl);
  assert(shareUrl.protocol === "https:" && shareUrl.hostname === "deeppane.com", "production share URL is not first-party HTTPS");
  assert(!stderr.trim(), "server wrote unexpected stderr output");
  console.log(JSON.stringify({ ok: true, package: packageJson.name, version: packageJson.version, idempotencyKey, shareId: firstData.payload.shareId, shareUrl: firstData.payload.shareUrl, retryStable: true }, null, 2));
} finally {
  child.stdin.end();
  child.kill();
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Timed out waiting for " + method)); }, 30000);
    pending.set(id, { resolve: (message) => { clearTimeout(timer); resolve(message); } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
