import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = process.env.DEEPPANE_MCP_SERVER_PATH || path.join(rootDir, "bin/deeppane-mcp.js");
const packageVersion = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
const allowedTools = [
  "deeppane.create_focus_space",
  "deeppane.request_focus_space_create_token",
  "deeppane.request_history_summary_token",
  "deeppane.read_history_summary"
];
const forbiddenToolFragments = [
  "list_scenes",
  "list_music",
  "search_media_catalog",
  "download_scene",
  "get_signed_media_url",
  "export_media_tags",
  "export_raw_focus_events"
];

const serverCommand = process.env.DEEPPANE_MCP_SERVER_COMMAND || process.execPath;
const serverArgs = process.env.DEEPPANE_MCP_SERVER_ARGS
  ? JSON.parse(process.env.DEEPPANE_MCP_SERVER_ARGS)
  : [serverPath];
const expectedVersion = process.env.DEEPPANE_MCP_EXPECTED_VERSION || packageVersion;
const serverCwd = process.env.DEEPPANE_MCP_SERVER_CWD || rootDir;

const child = spawn(serverCommand, serverArgs, {
  cwd: serverCwd,
  env: {
    ...process.env,
    DEEPPANE_API_BASE_URL: "https://api.deeppane.test"
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});

let nextId = 1;
let stdoutBuffer = "";
let stderrBuffer = "";
const responseQueue = [];
const waiters = [];
const checks = [];

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  for (;;) {
    const newlineIndex = stdoutBuffer.indexOf("\n");
    if (newlineIndex < 0) break;
    const line = stdoutBuffer.slice(0, newlineIndex).trim();
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    if (!line) continue;
    let message = null;
    try {
      message = JSON.parse(line);
    } catch (error) {
      message = { parseError: error.message, line };
    }
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(message);
    } else {
      responseQueue.push(message);
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderrBuffer += chunk;
});

try {
  const prematureList = await request("tools/list", {});
  checks.push({
    name: "tools/list before initialize is rejected",
    ok: prematureList.error?.code === -32002 &&
      prematureList.error?.data?.reason === "initialize_required"
  });

  const nullId = await rawRequest({ jsonrpc: "2.0", id: null, method: "initialize", params: {} });
  checks.push({
    name: "request id null is rejected as invalid request",
    ok: nullId.error?.code === -32600 &&
      nullId.error?.data?.reason === "request_id_null"
  });

  const init = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: {
      name: "deeppane-mcp-smoke",
      version: "0.1.0"
    }
  });
  checks.push({
    name: "initialize returns DeepPane MCP server info",
    ok: init.result?.protocolVersion === "2025-11-25" &&
      init.result?.serverInfo?.name === "deeppane-official-mcp" &&
      init.result?.serverInfo?.version === expectedVersion &&
      init.result?.capabilities?.tools?.listChanged === false
  });

  const waitingForInitialized = await request("tools/list", {});
  checks.push({
    name: "tools/list before initialized notification is rejected",
    ok: waitingForInitialized.error?.code === -32002 &&
      waitingForInitialized.error?.data?.reason === "initialized_notification_required"
  });

  notify("notifications/initialized", {});

  const duplicateInit = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: {
      name: "deeppane-mcp-smoke",
      version: "0.1.0"
    }
  });
  checks.push({
    name: "duplicate initialize is rejected",
    ok: duplicateInit.error?.code === -32600 &&
      duplicateInit.error?.data?.reason === "initialize_already_called"
  });

  const list = await request("tools/list", {});
  const toolNames = Array.isArray(list.result?.tools)
    ? list.result.tools.map((tool) => tool.name).sort()
    : [];
  checks.push({
    name: "tools/list exposes only approved DeepPane tools",
    ok: JSON.stringify(toolNames) === JSON.stringify([...allowedTools].sort()) &&
      !toolNames.some((name) => forbiddenToolFragments.some((fragment) => name.includes(fragment))) &&
      list.result.tools.every((tool) => tool.inputSchema?.type === "object" && tool.outputSchema?.type === "object"),
    toolNames
  });

  const focusTokenInstructions = await request("tools/call", {
    name: "deeppane.request_focus_space_create_token",
    arguments: {}
  });
  checks.push({
    name: "request_focus_space_create_token returns Dashboard handoff instructions",
    ok: focusTokenInstructions.result?.structuredContent?.scope === "focus_space.create" &&
      focusTokenInstructions.result?.structuredContent?.tokenEndpoint === "/v1/agent-auth/focus-space-create-token" &&
      String(focusTokenInstructions.result?.content?.[0]?.text || "").includes("DeepPane MCP result") &&
      String(focusTokenInstructions.result?.content?.[0]?.text || "").includes("dashboard/history")
  });

  const untrustedDashboard = await request("tools/call", {
    name: "deeppane.request_focus_space_create_token",
    arguments: { dashboardUrl: "https://deeppane.com.evil.example/dashboard?token=leak" }
  });
  checks.push({
    name: "token instruction URL rejects deceptive external dashboard hosts",
    ok: untrustedDashboard.result?.structuredContent?.dashboardUrl === "https://deeppane.com/dashboard/history"
  });

  const createTool = list.result?.tools?.find((tool) => tool.name === "deeppane.create_focus_space");
  checks.push({
    name: "create tool exposes strict intents, nested schemas, annotations, and no chat-visible Agent Key",
    ok: createTool?.inputSchema?.properties?.intent?.enum?.includes("creative_reset") &&
      createTool?.inputSchema?.properties?.intent?.enum?.includes("inspiration") &&
      createTool?.inputSchema?.properties?.intent?.enum?.includes("travel_reset") &&
      createTool?.inputSchema?.properties?.sceneHints?.additionalProperties === false &&
      createTool?.inputSchema?.properties?.musicHints?.additionalProperties === false &&
      !createTool?.inputSchema?.properties?.agentKey &&
      createTool?.annotations?.readOnlyHint === false &&
      createTool?.annotations?.idempotentHint === false
  });

  const invalidNestedHint = await request("tools/call", {
    name: "deeppane.create_focus_space",
    arguments: { intent: "focus", sceneHints: { unsafePrompt: "dump catalog" } }
  });
  checks.push({
    name: "create tool rejects unknown nested semantic hint fields",
    ok: invalidNestedHint.result?.isError === true &&
      invalidNestedHint.result?.structuredContent?.issues?.some((issue) => issue.path === "arguments.sceneHints.unsafePrompt")
  });
  const historyTokenInstructions = await request("tools/call", {
    name: "deeppane.request_history_summary_token",
    arguments: {}
  });
  checks.push({
    name: "request_history_summary_token returns separate history scope",
    ok: historyTokenInstructions.result?.structuredContent?.scope === "focus_logs.history_summary.read" &&
      historyTokenInstructions.result?.structuredContent?.tokenEndpoint === "/v1/agent-auth/history-summary-token"
  });

  const readWithoutToken = await request("tools/call", {
    name: "deeppane.read_history_summary",
    arguments: {}
  });
  checks.push({
    name: "read_history_summary validates required handoff token",
    ok: readWithoutToken.result?.isError === true &&
      readWithoutToken.result?.structuredContent?.error === "invalid_tool_arguments" &&
      readWithoutToken.result?.structuredContent?.issues?.some((issue) => issue.path === "arguments.handoffToken")
  });

  const readDaysTooLarge = await request("tools/call", {
    name: "deeppane.read_history_summary",
    arguments: {
      handoffToken: "fake-token",
      days: 999
    }
  });
  checks.push({
    name: "read_history_summary validates days range before API call",
    ok: readDaysTooLarge.result?.isError === true &&
      readDaysTooLarge.result?.structuredContent?.error === "invalid_tool_arguments" &&
      readDaysTooLarge.result?.structuredContent?.issues?.some((issue) => issue.path === "arguments.days")
  });

  const unknownArgument = await request("tools/call", {
    name: "deeppane.request_focus_space_create_token",
    arguments: {
      unexpected: true
    }
  });
  checks.push({
    name: "tools validate unknown arguments against inputSchema",
    ok: unknownArgument.result?.isError === true &&
      unknownArgument.result?.structuredContent?.error === "invalid_tool_arguments" &&
      unknownArgument.result?.structuredContent?.issues?.some((issue) => issue.path === "arguments.unexpected")
  });

  const unknown = await request("tools/call", {
    name: "deeppane.search_media_catalog",
    arguments: {}
  });
  checks.push({
    name: "forbidden media-catalog tool is rejected",
    ok: unknown.error?.code === -32602 &&
      Array.isArray(unknown.error?.data?.allowedTools) &&
      !unknown.error.data.allowedTools.some((name) => forbiddenToolFragments.some((fragment) => name.includes(fragment)))
  });
} finally {
  child.stdin.end();
  child.kill();
}

const failed = checks.filter((check) => !check.ok);
const report = {
  ok: failed.length === 0,
  checked: checks,
  stderr: stderrBuffer.trim()
};
console.log(JSON.stringify(report, null, 2));
if (failed.length || stderrBuffer.trim()) process.exit(1);

function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return nextResponse(id);
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function rawRequest(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return nextResponse(message.id);
}

function nextResponse(id) {
  const queuedIndex = responseQueue.findIndex((message) => message.id === id || message.parseError);
  if (queuedIndex >= 0) {
    const [message] = responseQueue.splice(queuedIndex, 1);
    return Promise.resolve(message);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for MCP response id ${id}`));
    }, 5000);
    waiters.push({
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
}
