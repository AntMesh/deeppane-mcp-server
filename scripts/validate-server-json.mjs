import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
const serverJson = JSON.parse(await readFile(path.join(packageDir, "server.json"), "utf8"));
const schemaUrl = String(serverJson.$schema || "");

if (!schemaUrl.startsWith("https://static.modelcontextprotocol.io/schemas/") || !schemaUrl.endsWith("/server.schema.json")) {
  throw new Error("server.json must use an official versioned MCP Registry schema URL.");
}

const response = await fetch(schemaUrl);
if (!response.ok) throw new Error("Unable to fetch MCP Registry schema: HTTP " + response.status);
const schema = await response.json();
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(serverJson)) {
  console.error(JSON.stringify(validate.errors, null, 2));
  throw new Error("server.json failed the official MCP Registry schema.");
}

const errors = [];
if (packageJson.mcpName !== serverJson.name) errors.push("package.json mcpName must match server.json name.");
if (packageJson.version !== serverJson.version) errors.push("Package and server versions must match.");
if (!Array.isArray(serverJson.packages) || serverJson.packages.length !== 1) errors.push("Exactly one public package is expected.");
const registryPackage = serverJson.packages?.[0] || {};
if (registryPackage.registryType !== "npm") errors.push("Registry package type must be npm.");
if (registryPackage.identifier !== packageJson.name) errors.push("Registry package identifier must match package.json name.");
if (registryPackage.version !== packageJson.version) errors.push("Registry package version must match package.json version.");
if (registryPackage.transport?.type !== "stdio") errors.push("Public package transport must be stdio.");
const publicEnvironment = registryPackage.environmentVariables || [];
const sensitiveName = /(agent.?key|api.?key|token|secret|authorization|cookie)/i;
if (publicEnvironment.some((entry) => sensitiveName.test(String(entry?.name || "")))) {
  errors.push("server.json must not advertise Agent Keys, tokens, or other secrets as public setup.");
}
if (errors.length) {
  for (const error of errors) console.error("- " + error);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  schema: schemaUrl,
  name: serverJson.name,
  package: registryPackage.identifier,
  version: serverJson.version,
  transport: registryPackage.transport.type
}, null, 2));
