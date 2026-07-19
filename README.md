# DeepPane MCP Server

The official stdio MCP server for creating DeepPane focus spaces and reading user-authorized focus history summaries.

## Requirements

- Node.js 20 or newer
- An MCP client that supports local stdio servers

## Run

```sh
npx -y @deeppane/mcp-server
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "deeppane": {
      "command": "npx",
      "args": ["-y", "@deeppane/mcp-server"]
    }
  }
}
```

## Tools

- `deeppane.create_focus_space`: create a retry-safe focus space using anonymous Free behavior or a user-authorized handoff token.
- `deeppane.read_history_summary`: read a sanitized focus-history summary with a user-authorized handoff token.
- `deeppane.request_focus_space_create_token`: open the DeepPane authorization handoff for focus-space creation.
- `deeppane.request_history_summary_token`: open the separate authorization handoff for history summaries.

The server does not expose the DeepPane media catalog, raw focus events, storage keys, signed media URLs, or user credentials.

## Optional environment settings

- `DEEPPANE_MCP_TIMEOUT_MS`: request timeout from 1000 to 60000 milliseconds. Default: 15000.

Normal public use requires no API key. Authorization for account-scoped tools is completed by the user in the DeepPane Dashboard and passed as a short-lived handoff token to the relevant tool call.

## Development

```sh
npm install
npm test
npm run check:clean-install
```

Documentation: https://deeppane.com/mcp
