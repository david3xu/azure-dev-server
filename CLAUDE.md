# azure-dev-server — Agent Guidelines

## Project overview

Remote MCP server that exposes filesystem and shell access over
Streamable HTTP transport. A cloud-hosted Desktop Commander for
Claude Desktop. Designed to run on Azure (Container Apps or Functions)
so Claude Desktop can read, write, build, and test on a remote machine.

## Build & test commands

```bash
pnpm run build          # TypeScript → dist/
pnpm run lint           # ESLint strict checks
pnpm run format:check   # Prettier formatting check
pnpm run format         # Auto-format all files
pnpm run type-check     # TypeScript type checking
pnpm run test           # Node.js built-in test runner
pnpm run check          # All of the above in sequence
pnpm run start          # Run compiled server (dist/server.js)
```

## Architecture

```
src/
  server.ts         → How does the HTTP server start and route requests?
  tools.ts          → What tools can Claude Desktop use remotely?
  tools-helpers.ts  → How do the file operation utilities work?
  auth.ts           → How are requests authenticated?
  types.ts          → What shapes exist?

Dockerfile        → Multi-stage build: builder (compile) → runner (prod deps + dist/)
docker-compose.yml → Local testing with /workspace volume mount
.dockerignore     → Excludes node_modules, dist, .git, tests from build context
```

Each source file answers ONE question. No file has two jobs.

Source is TypeScript (strict mode). Compiled to `dist/` via `pnpm run build`.
Tests import from `dist/`. Entry point: `dist/server.js`.

## Azure deployment

| Resource | Name |
|---|---|
| Resource Group | `rg-datacore` (australiaeast) |
| Container Registry | `acrdevserver.azurecr.io` |
| Container App | `ca-dev-server` |
| FQDN | `ca-dev-server.blackrock-ecaa139a.australiaeast.azurecontainerapps.io` |

Re-deploy after code changes:
```bash
az acr build --registry acrdevserver --image azure-dev-server:latest --file Dockerfile .
az containerapp update --name ca-dev-server --resource-group rg-datacore \
  --image acrdevserver.azurecr.io/azure-dev-server:latest
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default: 3001) |
| `MCP_API_KEY` | Yes | API key for x-api-key header auth |
| `WORKSPACE` | No | Root directory for file operations (default: cwd) |

## Gotchas

1. **Auth is API key, not OAuth.** Claude Desktop doesn't support Entra
   OAuth for custom MCP servers yet. Use `x-api-key` header.
2. **Express 5, not 4.** We use Express 5 which has native async handler
   support. No need for express-async-errors.
3. **Streamable HTTP, not SSE.** MCP spec deprecated SSE in March 2025.
   Use the `/mcp` endpoint with POST/GET/DELETE.
4. **Session state lives in memory.** Each POST to `/mcp` without a
   session ID creates a new session. The `mcp-session-id` header
   routes subsequent requests to the correct transport.
5. **Shell commands have a 60s timeout.** Long-running builds may need
   the timeout increased via environment variable.
6. **MCP session requires two requests.** POST `/mcp` to initialize (no
   session header) → capture `mcp-session-id` response header → pass it
   on every subsequent request. Without it you get "Server not initialized".
7. **WORKSPACE on Azure is empty.** `/workspace` in the container has no
   files yet. Azure Files share mount is the next step (Phase 4 extension).
8. **`az acr build` skips local Docker.** Build and push happen entirely
   in ACR cloud agents — no Docker Desktop required on the dev machine.

## Code style

- Strict mode (`strict: true` in tsconfig, all strict options)
- `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- ES modules only (`import`/`export`, not `require`)
- `unknown` over `any` — narrow with type guards
- `eqeqeq` enforced — always `===`
- `prefer-const` — never use `let` if the value doesn't change
- Zod for schema validation on MCP tool inputs

## Constraint stack

```
CI (GitHub Actions)     ✅  format → lint → type-check → build → test + audit
  Pre-commit hook       ✅  simple-git-hooks → pnpm run check (blocks bad commits)
    Linter (ESLint)     ✅  strict, no-any, eqeqeq
      Types (TypeScript)✅  strict mode, compiled
        Tests           ✅  Node.js built-in test runner
          Formatter     ✅  Prettier configured
            Schemas     ✅  Zod on all tool inputs
```

## References

- `CLAUDE.md` — this project's agent guidelines and gotchas (canonical file)
- `../docs/azure-dev-server/IMPLEMENTATION-PLAN.md` — phased migration roadmap (design doc, lives in developer/docs/)
- `../docs/CODE-DISCIPLINE.md` — constraint stack and structural rules
- `../docs/workflow.md` — PROBLEM → RESEARCH → DIGEST → DESIGN → PLAN → BUILD → REVIEW

## Documentation rules

After completing any task:
1. Run `pnpm run check`
2. Search for any value you changed across `~/Developer/docs/` and `*/CLAUDE.md`
3. Include "Docs checked: [clean | updated X, Y, Z]" in task_completed event

If you changed a metric (test count, tool count, file count):
- Update ONLY this CLAUDE.md — it is the canonical source
- Do NOT update other docs — they should link here, not duplicate
