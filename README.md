# azure-dev-server

Remote MCP server that gives Claude Desktop full filesystem and shell access over HTTPS — a cloud-hosted [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) running on Azure Container Apps.

## What it does

Exposes 8 MCP tools so Claude Desktop can read, write, edit, search, and run commands on a remote machine:

| Tool             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `ping`           | Health check                                       |
| `read_file`      | Read a file with line numbers                      |
| `write_file`     | Write or append to a file                          |
| `edit_file`      | Surgical find-and-replace (single occurrence)      |
| `search_files`   | Grep across a directory with optional file pattern |
| `list_directory` | List files/dirs with recursion depth               |
| `run_command`    | Execute a shell command, returns stdout/stderr     |
| `get_file_info`  | File metadata (size, type, modified time)          |

## Why it exists

Claude Desktop's built-in Desktop Commander only works locally. This project gives Claude Desktop the same capabilities on a remote Azure machine — useful when the workspace lives in the cloud or needs to be shared across devices.

## Quickstart (local)

```bash
git clone https://github.com/david3xu/azure-dev-server.git
cd azure-dev-server
pnpm install
pnpm run build
MCP_API_KEY=your-key WORKSPACE=/path/to/your/workspace pnpm start
```

Health check:

```bash
curl http://localhost:3001/health
```

## Connect to the live instance

The server runs at:

```
https://ca-dev-server.purplegrass-77b8c839.australiaeast.azurecontainerapps.io
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "azure-dev": {
      "url": "https://ca-dev-server.purplegrass-77b8c839.australiaeast.azurecontainerapps.io/mcp",
      "headers": {
        "x-api-key": "<your-api-key>"
      }
    }
  }
}
```

Reload the window (`Cmd+Shift+P` → "Reload Window") — the 8 tools appear in the MCP panel.

### VSCode + GitHub Copilot

Add to `.vscode/mcp.json` (per workspace) or user `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "azure-dev": {
        "type": "http",
        "url": "https://ca-dev-server.purplegrass-77b8c839.australiaeast.azurecontainerapps.io/mcp",
        "headers": {
          "x-api-key": "<your-api-key>"
        }
      }
    }
  }
}
```

### Claude Desktop

Claude Desktop only supports stdio transport, so use [mcp-remote](https://github.com/geelen/mcp-remote) as an HTTP bridge.

Create `~/Library/Application Support/Claude/azure-dev-mcp-bridge.sh`:

```zsh
#!/bin/zsh
set -euo pipefail

exec /opt/homebrew/bin/npx -y mcp-remote \
  "https://ca-dev-server.purplegrass-77b8c839.australiaeast.azurecontainerapps.io/mcp" \
  --transport http-first \
  --header "x-api-key:<your-api-key>"
```

Then add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "azure-dev": {
      "command": "/bin/zsh",
      "args": ["/Users/<you>/Library/Application Support/Claude/azure-dev-mcp-bridge.sh"]
    }
  }
}
```

Restart Claude Desktop (`Cmd+Q`, reopen).

### Terminal (interactive shell inside the container)

Requires [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).

**Step 1** — Add the alias to your shell profile (once):

```bash
echo "alias azure-dev-shell='az containerapp exec \\
  --name ca-dev-server \\
  --resource-group rg-datacore \\
  --command bash'" >> ~/.zshrc
```

**Step 2** — Load it in your current terminal:

```bash
source ~/.zshrc
```

**Step 3** — Connect:

```bash
azure-dev-shell
```

You will see `INFO: Successfully connected to container: 'ca-dev-server'` and a shell prompt.

> **Tips inside the container:**
> - `clear` is not available — use **`Ctrl+L`** instead
> - The prompt may show `sh-5.2#` — run `bash` to switch to a full Bash session
> - `/workspace` is the Azure Files mount — files written here persist across restarts
> - Exit with **`Ctrl+D`**

### Verify the connection

After connecting via any client, run these tools in order:

1. `ping` — should return `"alive — workspace: /workspace"`
2. `list_directory` with `path: "/"` — lists the workspace root
3. `write_file` then `read_file` — confirms read/write access

## Environment variables

| Variable      | Required | Default             | Description                            |
| ------------- | -------- | ------------------- | -------------------------------------- |
| `MCP_API_KEY` | Yes      | `dev-key-change-me` | API key sent in `x-api-key` header     |
| `WORKSPACE`   | No       | `process.cwd()`     | Root directory for all file operations |
| `PORT`        | No       | `3001`              | HTTP port                              |

## Deploy to Azure Container Apps

Requires Azure CLI. No local Docker needed — image is built in the cloud:

```bash
# One-time setup
az group create --name rg-datacore --location australiaeast
az acr create --name acrdevserver --resource-group rg-datacore --sku Basic --admin-enabled true
az containerapp env create --name cae-dev-server --resource-group rg-datacore --location australiaeast

# Build + deploy
az acr build --registry acrdevserver --image azure-dev-server:latest --file Dockerfile .

ACR_PASS=$(az acr credential show --name acrdevserver --query "passwords[0].value" -o tsv)
az containerapp create \
  --name ca-dev-server \
  --resource-group rg-datacore \
  --environment cae-dev-server \
  --image acrdevserver.azurecr.io/azure-dev-server:latest \
  --registry-server acrdevserver.azurecr.io \
  --registry-username acrdevserver \
  --registry-password "$ACR_PASS" \
  --target-port 3001 --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --cpu 0.5 --memory 1.0Gi \
  --env-vars "MCP_API_KEY=<your-key>" "NODE_ENV=production" "PORT=3001" "WORKSPACE=/workspace"
```

Re-deploy after code changes:

```bash
az acr build --registry acrdevserver --image azure-dev-server:latest --file Dockerfile .
az containerapp update --name ca-dev-server --resource-group rg-datacore \
  --image acrdevserver.azurecr.io/azure-dev-server:latest
```

## Development

```bash
pnpm run check      # format + lint + type-check + build + test (all layers)
pnpm run test       # tests only
pnpm run format     # auto-format src/ and tests/
```

All 7 constraint layers active: CI → pre-commit hook → ESLint → TypeScript strict → tests → Prettier → Zod schemas.

## Tech stack

- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — Streamable HTTP transport
- [Express 5](https://expressjs.com/) — HTTP server
- [Zod](https://zod.dev/) — input validation on all tools
- TypeScript strict mode, Node.js 22, pnpm

## License

MIT
