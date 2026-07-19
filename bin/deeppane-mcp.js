#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_VERSION = readPackageVersion();
const SERVER_NAME = "deeppane-official-mcp";
const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const DEFAULT_API_BASE_URL = "https://api.deeppane.com";
const DEFAULT_DASHBOARD_URL = "https://deeppane.com/dashboard/history";
const USER_AGENT = `DeepPane-Official-MCP/${SERVER_VERSION}`;
const MCP_NOT_READY_ERROR = -32002;

function readPackageVersion() {
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const packageJsonPath = path.join(packageDir, "package.json");
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const version = String(packageJson.version || "").trim();
    return version || "0.0.0-dev";
  } catch (_) {
    return "0.0.0-dev";
  }
}

const ARGUMENT_ISSUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["path", "message"],
  properties: {
    path: { type: "string" },
    message: { type: "string" },
    expected: { type: "string" },
    received: { type: "string" }
  }
};

const API_TOOL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
    apiStatus: { type: "integer" },
    payload: {
      type: "object",
      additionalProperties: true,
      properties: {
        ok: { type: "boolean" },
        schemaVersion: { type: "integer" },
        shareUrl: { type: "string" },
        shortShareUrl: { type: "string" },
        longShareUrl: { type: "string" },
        qrCodeUrl: { type: "string" },
        qrCodePngUrl: { type: "string" },
        qrCodeSvgUrl: { type: "string" },
        shareId: { type: "string" },
        expiresAt: { type: "string" },
        policy: { type: "object", additionalProperties: true },
        selected: { type: "object", additionalProperties: true },
        conversion: { type: "object", additionalProperties: true },
        audience: { type: "string" },
        purpose: { type: "string" },
        window: { type: "object", additionalProperties: true },
        metrics: { type: "object", additionalProperties: true },
        periods: { type: "array", items: { type: "object", additionalProperties: true } },
        weeklyTrend: { type: "array", items: { type: "object", additionalProperties: true } },
        highlights: { type: "array", items: { type: "string" } },
        recommendations: { type: "array", items: { type: "string" } },
        markdown: { type: "string" },
        generatedAt: { type: "string" }
      }
    },
    error: { type: "string" },
    message: { type: "string" },
    tool: { type: "string" },
    issues: { type: "array", items: ARGUMENT_ISSUE_SCHEMA },
    next: { type: "string" }
  }
};

const TOKEN_INSTRUCTIONS_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
    action: { type: "string" },
    dashboardUrl: { type: "string" },
    tokenEndpoint: { type: "string" },
    scope: { type: "string" },
    audience: { type: "string" },
    next: { type: "string" },
    error: { type: "string" },
    tool: { type: "string" },
    issues: { type: "array", items: ARGUMENT_ISSUE_SCHEMA }
  }
};

const FORBIDDEN_TOOL_NAMES = new Set([
  "deeppane.list_scenes",
  "deeppane.list_music",
  "deeppane.search_media_catalog",
  "deeppane.download_scene",
  "deeppane.get_signed_media_url",
  "deeppane.export_media_tags",
  "deeppane.export_raw_focus_events"
]);

const TOOLS = [
  {
    name: "deeppane.create_focus_space",
    title: "Create DeepPane Focus Space",
    description: [
      "Create an agent-selected DeepPane focus space through the public agent contract.",
      "Use handoffToken for user-authorized Pro/Free entitlements, or omit it for anonymous Free behavior.",
      "This tool returns share/dashboard links and sanitized selection metadata only; it never exposes media catalog data or R2 keys."
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        handoffToken: {
          type: "string",
          minLength: 1,
          maxLength: 4096,
          description: "Short-lived focus_space.create token copied from the DeepPane Dashboard Agent Access panel."
        },

        intent: {
          type: "string",
          enum: ["ambient_work", "coding", "creative_reset", "deep_work", "focus", "inspiration", "planning", "reading", "recovery", "study", "travel_reset", "writing"],
          minLength: 1,
          maxLength: 80,
          description: "Supported work intent used for semantic scene and music selection."
        },
        idempotencyKey: {
          type: "string",
          minLength: 8,
          maxLength: 160,
          description: "Stable opaque key for retry-safe creation. Reuse only for the same logical request."
        },
        operationId: {
          type: "string",
          minLength: 1,
          maxLength: 96,
          description: "Stable operation id, combined with attribution.agentRunId when idempotencyKey is omitted."
        },
        locale: {
          type: "string",
          minLength: 2,
          maxLength: 16,
          description: "Optional DeepPane locale, for example en or zh-CN."
        },
        timer: {
          type: "object",
          additionalProperties: false,
          properties: {
            preset: { type: "string", maxLength: 32 },
            presetId: { type: "string", maxLength: 32 },
            focusSeconds: { type: "integer", minimum: 300, maximum: 10800 },
            focusMinutes: { type: "integer", minimum: 5, maximum: 180 },
            breakSeconds: { type: "integer", minimum: 0, maximum: 3600 },
            breakMinutes: { type: "integer", minimum: 0, maximum: 60 },
            durationMinutes: { type: "integer", minimum: 5, maximum: 240 }
          },
          description: "Bounded timer request."
        },
        sceneHints: {
          type: "object",
          additionalProperties: false,
          properties: {
            brightness: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, environment: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, focusSafety: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, mood: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, motion: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, sound: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, timeOfDay: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, visualDensity: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }
          },
          description: "Safe semantic hints for scene selection, not raw catalog filters."
        },
        musicHints: {
          type: "object",
          additionalProperties: false,
          properties: {
            distractionLevel: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, energyLevel: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, mood: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, sound: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, style: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, use: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }, vocalProfile: { anyOf: [{ type: "string", maxLength: 80 }, { type: "array", maxItems: 8, items: { type: "string", maxLength: 80 } }] }
          },
          description: "Safe semantic hints for music selection, not raw track metadata."
        },
        quote: {
          type: "object",
          additionalProperties: false,
          properties: { mode: { type: "string", enum: ["catalog", "custom"] }, intent: { type: "string", maxLength: 80 }, text: { type: "string", maxLength: 280 }, customText: { type: "string", maxLength: 280 }, author: { type: "string", maxLength: 80 }, title: { type: "string", maxLength: 80 } },
          description: "Quote request. Free uses catalog quotes; Pro handoff tokens may allow custom quote text."
        },
        attribution: {
          type: "object",
          additionalProperties: false,
          properties: { agentRunId: { type: "string", maxLength: 96 }, runId: { type: "string", maxLength: 96 }, source: { type: "string", maxLength: 48 } },
          description: "Optional safe caller attribution. Do not include secrets, account data, raw prompts, or personal history."
        }
      }
    },
    outputSchema: API_TOOL_OUTPUT_SCHEMA
  },
  {
    name: "deeppane.request_focus_space_create_token",
    title: "Request Focus Space Token",
    description: "Return the first-party Dashboard handoff instructions for creating a short-lived focus_space.create token.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dashboardUrl: {
          type: "string",
          format: "uri",
          description: "Optional Dashboard URL override to show the user."
        }
      }
    },
    outputSchema: TOKEN_INSTRUCTIONS_OUTPUT_SCHEMA
  },
  {
    name: "deeppane.request_history_summary_token",
    title: "Request History Summary Token",
    description: "Return the first-party Dashboard handoff instructions for creating a short-lived focus_logs.history_summary.read token.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dashboardUrl: {
          type: "string",
          format: "uri",
          description: "Optional Dashboard URL override to show the user."
        }
      }
    },
    outputSchema: TOKEN_INSTRUCTIONS_OUTPUT_SCHEMA
  },
  {
    name: "deeppane.read_history_summary",
    title: "Read DeepPane History Summary",
    description: [
      "Read the agent-safe DeepPane work-time history summary using a short-lived Dashboard handoff token.",
      "This tool does not expose raw events, media metadata, or account profile data."
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["handoffToken"],
      properties: {
        handoffToken: {
          type: "string",
          minLength: 1,
          maxLength: 4096,
          description: "Short-lived focus_logs.history_summary.read token copied from the DeepPane Dashboard Agent Access panel."
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 180,
          description: "History window in days. Defaults to 90."
        }
      }
    },
    outputSchema: API_TOOL_OUTPUT_SCHEMA
  }
];

for (const tool of TOOLS) {
  const readOnly = tool.name !== "deeppane.create_focus_space";
  tool.annotations = {
    readOnlyHint: readOnly,
    destructiveHint: false,
    idempotentHint: readOnly,
    openWorldHint: tool.name === "deeppane.create_focus_space"
  };
}

const TOOL_HANDLERS = new Map([
  ["deeppane.create_focus_space", createFocusSpace],
  ["deeppane.request_focus_space_create_token", requestFocusSpaceCreateToken],
  ["deeppane.request_history_summary_token", requestHistorySummaryToken],
  ["deeppane.read_history_summary", readHistorySummary]
]);

let inputBuffer = "";
let lifecycleState = "new";
const activeRequests = new Map();

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  flushInputBuffer(false);
});
process.stdin.on("end", () => {
  flushInputBuffer(true);
});
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

function flushInputBuffer(flushRemainder) {
  for (;;) {
    const newlineIndex = inputBuffer.indexOf("\n");
    if (newlineIndex < 0) break;
    const line = inputBuffer.slice(0, newlineIndex).trim();
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (line) void handleLine(line);
  }
  if (flushRemainder && inputBuffer.trim()) {
    const line = inputBuffer.trim();
    inputBuffer = "";
    void handleLine(line);
  }
}

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    sendError(null, -32700, "Parse error", { message: error.message });
    return;
  }

  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
    sendError(message?.id ?? null, -32600, "Invalid Request");
    return;
  }

  if (message.id === null) {
    sendError(null, -32600, "Invalid Request", {
      reason: "request_id_null",
      message: "JSON-RPC request id must not be null. Omit id only for notifications."
    });
    return;
  }

  if (message.id === undefined) {
    await handleNotification(message).catch(() => {});
    return;
  }

  const controller = new AbortController();
  activeRequests.set(String(message.id), controller);
  try {
    const result = await handleRequest(message, controller.signal);
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    const code = Number.isInteger(error?.code) ? error.code : -32603;
    sendError(message.id, code, error?.message || "Internal error", error?.data);
  } finally {
    activeRequests.delete(String(message.id));
  }
}

async function handleNotification(message) {
  if (message.method === "notifications/cancelled") {
    const requestId = message.params?.requestId;
    if (requestId !== undefined && requestId !== null) activeRequests.get(String(requestId))?.abort();
    return;
  }
  if (message.method === "notifications/initialized" || message.method === "initialized") {
    if (lifecycleState === "initialized") {
      lifecycleState = "ready";
    }
    return;
  }
}

async function handleRequest(message, signal) {
  enforceLifecycleForRequest(message.method);
  switch (message.method) {
    case "initialize":
      return initializeResult(message.params || {});
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS.filter((tool) => !FORBIDDEN_TOOL_NAMES.has(tool.name)) };
    case "tools/call":
      return await callTool(message.params || {}, { signal, requestId: String(message.id) });
    default: {
      const error = new Error(`Method not found: ${message.method}`);
      error.code = -32601;
      throw error;
    }
  }
}

function initializeResult(params) {
  if (lifecycleState !== "new") {
    const error = new Error("Initialize has already been completed for this MCP server session.");
    error.code = -32600;
    error.data = {
      reason: "initialize_already_called",
      next: lifecycleState === "initialized"
        ? "Send notifications/initialized, then call tools/list or tools/call."
        : "Call tools/list or tools/call on the existing initialized session."
    };
    throw error;
  }
  if (!isPlainObject(params)) {
    const error = new Error("Initialize params must be an object.");
    error.code = -32602;
    error.data = { reason: "invalid_initialize_params" };
    throw error;
  }
  lifecycleState = "initialized";
  const requestedVersion = String(params.protocolVersion || "");
  return {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
      ? requestedVersion
      : PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false
      }
    },
    serverInfo: {
      name: SERVER_NAME,
      title: "DeepPane Official MCP Server",
      version: SERVER_VERSION
    },
    instructions: [
      "Use DeepPane Dashboard Agent Access to mint short-lived handoff tokens.",
      "This server exposes focus-space creation and history-summary reading only.",
      "It must not be used as a media catalog, raw event export, or asset download server."
    ].join(" ")
  };
}

function enforceLifecycleForRequest(method) {
  if (method === "initialize" || method === "ping") return;
  if (lifecycleState === "new") {
    const error = new Error("MCP server is not initialized. Call initialize before other methods.");
    error.code = MCP_NOT_READY_ERROR;
    error.data = {
      reason: "initialize_required",
      next: "Call initialize with a supported protocolVersion, then send notifications/initialized."
    };
    throw error;
  }
  if (lifecycleState === "initialized") {
    const error = new Error("MCP server is waiting for notifications/initialized before tool operations.");
    error.code = MCP_NOT_READY_ERROR;
    error.data = {
      reason: "initialized_notification_required",
      next: "Send notifications/initialized, then call tools/list or tools/call."
    };
    throw error;
  }
}

async function callTool(params, context = {}) {
  if (!isPlainObject(params)) {
    const error = new Error("tools/call params must be an object with name and arguments.");
    error.code = -32602;
    error.data = { reason: "invalid_tools_call_params" };
    throw error;
  }
  const name = String(params.name || "").trim();
  if (!TOOL_HANDLERS.has(name)) {
    const error = new Error(`Unknown DeepPane tool: ${name}`);
    error.code = -32602;
    error.data = { allowedTools: TOOLS.map((tool) => tool.name) };
    throw error;
  }
  if (params.arguments !== undefined && !isPlainObject(params.arguments)) {
    return invalidArgumentsToolResult(name, [
      {
        path: "arguments",
        message: "Tool arguments must be a JSON object.",
        expected: "object",
        received: describeValue(params.arguments)
      }
    ]);
  }
  const args = params.arguments || {};
  const validation = validateToolArguments(name, args);
  if (!validation.ok) {
    return invalidArgumentsToolResult(name, validation.issues);
  }
  return await TOOL_HANDLERS.get(name)(args, context);
}

async function createFocusSpace(args, context = {}) {
  const body = {};
  if (hasString(args.intent)) body.intent = sanitizeToken(args.intent, 80);
  if (hasString(args.locale)) body.locale = sanitizeToken(args.locale, 16);
  if (isPlainObject(args.timer)) body.timer = args.timer;
  if (isPlainObject(args.sceneHints)) body.sceneHints = args.sceneHints;
  if (isPlainObject(args.musicHints)) body.musicHints = args.musicHints;
  if (isPlainObject(args.quote)) body.quote = args.quote;
  if (isPlainObject(args.attribution)) body.attribution = args.attribution;
  if (hasString(args.idempotencyKey)) body.idempotencyKey = sanitizeToken(args.idempotencyKey, 160);
  if (hasString(args.operationId)) body.operationId = sanitizeToken(args.operationId, 96);

  const response = await deepPaneApiJson({
    method: "POST",
    path: "/v1/agent/focus-spaces",
    handoffToken: args.handoffToken,
    body,
    signal: context.signal,
    mcpRequestId: context.requestId
  });
  return apiToolResult(response, "DeepPane focus space creation response");
}

async function requestFocusSpaceCreateToken(args) {
  const dashboardUrl = normalizeDashboardUrl(args.dashboardUrl);
  return textToolResult({
    ok: true,
    action: "open_dashboard_agent_access",
    dashboardUrl,
    tokenEndpoint: "/v1/agent-auth/focus-space-create-token",
    scope: "focus_space.create",
    audience: "deeppane.agent.focus-space-create",
    next: "Open the Dashboard Agent Access panel, choose Create focus-space token, then paste the short-lived token into deeppane.create_focus_space as handoffToken."
  });
}

async function requestHistorySummaryToken(args) {
  const dashboardUrl = normalizeDashboardUrl(args.dashboardUrl);
  return textToolResult({
    ok: true,
    action: "open_dashboard_agent_access",
    dashboardUrl,
    tokenEndpoint: "/v1/agent-auth/history-summary-token",
    scope: "focus_logs.history_summary.read",
    audience: "deeppane.agent.history-summary",
    next: "Open the Dashboard Agent Access panel, choose Create history token, then paste the short-lived token into deeppane.read_history_summary as handoffToken."
  });
}

async function readHistorySummary(args) {
  const handoffToken = String(args.handoffToken || "").trim();
  const days = normalizeInteger(args.days, 90, 1, 180);
  const response = await deepPaneApiJson({
    method: "GET",
    path: `/v1/focus-logs/history-summary?days=${encodeURIComponent(String(days))}`,
    handoffToken
  });
  return apiToolResult(response, "DeepPane history summary response");
}

function validateToolArguments(name, args) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  const schema = tool?.inputSchema || {};
  const issues = [];
  validateObjectAgainstSchema(args, schema, "arguments", issues);
  return {
    ok: issues.length === 0,
    issues
  };
}

function validateObjectAgainstSchema(value, schema, path, issues) {
  if (!isPlainObject(value)) {
    issues.push({
      path,
      message: `${path} must be a JSON object.`,
      expected: "object",
      received: describeValue(value)
    });
    return;
  }
  const properties = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  required.forEach((key) => {
    if (value[key] === undefined) {
      issues.push({
        path: `${path}.${key}`,
        message: `Missing required argument: ${key}.`,
        expected: describeSchema(properties[key] || {})
      });
    }
  });
  if (schema.additionalProperties === false) {
    Object.keys(value).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        issues.push({
          path: `${path}.${key}`,
          message: `Unknown argument: ${key}.`,
          expected: `one of ${Object.keys(properties).join(", ") || "(none)"}`,
          received: describeValue(value[key])
        });
      }
    });
  }
  Object.entries(properties).forEach(([key, propertySchema]) => {
    if (value[key] !== undefined) {
      validateValueAgainstSchema(value[key], propertySchema, `${path}.${key}`, issues);
    }
  });
}

function validateValueAgainstSchema(value, schema, path, issues) {
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((candidate) => {
      const branchIssues = [];
      validateValueAgainstSchema(value, candidate, path, branchIssues);
      return branchIssues;
    });
    if (branches.some((branch) => branch.length === 0)) return;
    issues.push({ path, message: `${path} does not match any allowed shape.`, expected: "one of the documented schemas", received: describeValue(value) });
    return;
  }
  const type = schema.type || "any";
  if (type === "string") {
    if (typeof value !== "string") {
      issues.push({
        path,
        message: `${path} must be a string.`,
        expected: describeSchema(schema),
        received: describeValue(value)
      });
      return;
    }
    if (Number.isInteger(schema.minLength) && value.trim().length < schema.minLength) {
      issues.push({
        path,
        message: `${path} must not be empty.`,
        expected: describeSchema(schema),
        received: "empty string"
      });
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      issues.push({
        path,
        message: `${path} is too long.`,
        expected: describeSchema(schema),
        received: `${value.length} characters`
      });
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      issues.push({ path, message: `${path} must be one of: ${schema.enum.join(", ")}.`, expected: `enum ${schema.enum.join(", ")}`, received: value });
    }
    if (schema.format === "uri" && !isValidUrl(value)) {
      issues.push({
        path,
        message: `${path} must be a valid URL.`,
        expected: "uri",
        received: value
      });
    }
    return;
  }

  if (type === "integer") {
    if (!Number.isInteger(value)) {
      issues.push({
        path,
        message: `${path} must be an integer.`,
        expected: describeSchema(schema),
        received: describeValue(value)
      });
      return;
    }
    if (Number.isFinite(schema.minimum) && value < schema.minimum) {
      issues.push({
        path,
        message: `${path} must be at least ${schema.minimum}.`,
        expected: describeSchema(schema),
        received: String(value)
      });
    }
    if (Number.isFinite(schema.maximum) && value > schema.maximum) {
      issues.push({
        path,
        message: `${path} must be at most ${schema.maximum}.`,
        expected: describeSchema(schema),
        received: String(value)
      });
    }
    return;
  }

  if (type === "object") {
    if (!isPlainObject(value)) {
      issues.push({
        path,
        message: `${path} must be a JSON object.`,
        expected: describeSchema(schema),
        received: describeValue(value)
      });
      return;
    }
    if (schema.additionalProperties === false || schema.properties || schema.required) {
      validateObjectAgainstSchema(value, schema, path, issues);
    }
    return;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      issues.push({ path, message: `${path} must be an array.`, expected: describeSchema(schema), received: describeValue(value) });
      return;
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      issues.push({ path, message: `${path} has too many items.`, expected: `at most ${schema.maxItems} items`, received: `${value.length} items` });
    }
    if (schema.items) value.forEach((item, index) => validateValueAgainstSchema(item, schema.items, `${path}[${index}]`, issues));
    return;
  }

  if (type === "array" && !Array.isArray(value)) {
    issues.push({
      path,
      message: `${path} must be an array.`,
      expected: describeSchema(schema),
      received: describeValue(value)
    });
  }
}

function invalidArgumentsToolResult(tool, issues) {
  return textToolResult({
    ok: false,
    error: "invalid_tool_arguments",
    tool,
    issues,
    next: "Fix the arguments to match the tool inputSchema, then call the tool again."
  }, { isError: true, label: "DeepPane MCP argument validation error" });
}

async function deepPaneApiJson({ method, path, handoffToken, body, signal, mcpRequestId }) {
  if (typeof fetch !== "function") {
    return {
      ok: false,
      status: 0,
      error: "fetch_unavailable",
      message: "This MCP server requires a Node.js runtime with global fetch support."
    };
  }

  const url = new URL(path, normalizeApiBaseUrl());
  const headers = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...(mcpRequestId ? { "X-DeepPane-MCP-Request-Id": String(mcpRequestId).slice(0, 96) } : {})
  };
  const token = String(handoffToken || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const resolvedAgentKey = String(process.env.DEEPPANE_AGENT_KEY || "").trim();
  if (resolvedAgentKey) headers["X-DeepPane-Agent-Key"] = resolvedAgentKey;

  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), normalizeInteger(process.env.DEEPPANE_MCP_TIMEOUT_MS, 15000, 1000, 60000));
  try {
    const response = await fetch(url, {
      method,
      headers: method === "POST" ? { ...headers, "Content-Type": "application/json" } : headers,
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = parseJsonText(text);
    return {
      ok: response.ok && payload?.ok !== false,
      status: response.status,
      payload: payload ?? { text }
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.name === "AbortError" ? "request_timeout" : "request_failed",
      message: error?.message || "DeepPane API request failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function apiToolResult(response, label) {
  const isError = response.ok !== true;
  return textToolResult(scrubSecrets({
    ok: response.ok === true,
    apiStatus: response.status,
    ...(response.payload ? { payload: response.payload } : {}),
    ...(response.error ? { error: response.error } : {}),
    ...(response.message ? { message: response.message } : {})
  }), { isError, label, concise: true });
}

function textToolResult(value, options = {}) {
  const safeValue = scrubSecrets(value);
  const summary = safeValue.ok ? "ok" : safeValue.error || safeValue.message || "failed";
  return {
    ...(options.isError ? { isError: true } : {}),
    structuredContent: safeValue,
    content: [
      {
        type: "text",
        text: options.concise
          ? `${options.label || "DeepPane MCP result"}: ${summary}`
          : `${options.label || "DeepPane MCP result"}\n${JSON.stringify(safeValue, null, 2)}`
      }
    ]
  };
}
function scrubSecrets(value, key = "") {
  const sensitive = /(^|_)(token|secret|authorization|cookie|api.?key|signed.?url|write.?token)($|_)/i.test(key);
  if (sensitive) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, scrubSecrets(childValue, childKey)]));
  }
  return value;
}
function normalizeApiBaseUrl() {
  const raw = String(process.env.DEEPPANE_API_BASE_URL || DEFAULT_API_BASE_URL).trim();
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return DEFAULT_API_BASE_URL;
  }
}

function normalizeDashboardUrl(value) {
  const raw = String(value || process.env.DEEPPANE_DASHBOARD_URL || DEFAULT_DASHBOARD_URL).trim();
  try {
    const url = new URL(raw);
    const official = url.protocol === "https:" && url.hostname === "deeppane.com" && !url.username && !url.password;
    const localAllowed = process.env.DEEPPANE_MCP_ALLOW_LOCAL_DASHBOARD === "1"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password;
    return official || localAllowed ? url.toString() : DEFAULT_DASHBOARD_URL;
  } catch (_) {
    return DEFAULT_DASHBOARD_URL;
  }
}

function parseJsonText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function describeSchema(schema = {}) {
  const parts = [schema.type || "any"];
  if (Number.isInteger(schema.minimum) || Number.isInteger(schema.maximum)) {
    parts.push(`[${schema.minimum ?? "-∞"}..${schema.maximum ?? "∞"}]`);
  }
  if (Number.isInteger(schema.minLength) || Number.isInteger(schema.maxLength)) {
    parts.push(`length ${schema.minLength ?? 0}..${schema.maxLength ?? "∞"}`);
  }
  if (schema.format) parts.push(`format ${schema.format}`);
  return parts.join(" ");
}

function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function sanitizeToken(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/[^\p{L}\p{N}_.:-]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, code, message, data) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  });
}
