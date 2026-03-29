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
pnpm run test           # Node.js built-in test runner (25 tests, 8 suites)
pnpm run check          # All of the above in sequence
pnpm run start          # Run compiled server (dist/server.js)
```

## Architecture

```
src/
  server.ts   → How does the HTTP server start and route requests?
  tools.ts    → What tools can Claude Desktop use remotely?
  fs-ops.ts   → How are filesystem read and search operations implemented?
  auth.ts     → How are requests authenticated?
  types.ts    → What shapes exist?

tests/
  server.test.mjs   → Does the HTTP server start and respond correctly?
  tools.test.mjs    → Do the phase-2 tools (edit_file, search_files) behave correctly?
  fs-ops.test.mjs   → Do the filesystem read and search operations work correctly?

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
| FQDN | `ca-dev-server.purplegrass-77b8c839.australiaeast.azurecontainerapps.io` |

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
7. **WORKSPACE is the Azure Files mount.** `/workspace` in the container
   is mounted to the `workspace` file share in `stdevserverau` (storage
   account). Files written here persist across restarts and revisions.
8. **`az acr build` skips local Docker.** Build and push happen entirely
   in ACR cloud agents — no Docker Desktop required on the dev machine.
9. **`clear` is not available in the slim image.** Use `Ctrl+L` in the
   terminal. `ncurses-bin` is in the Dockerfile — available after next deploy.
10. **Two revisions can be active at once.** The bootstrap used a placeholder
    image (`mcr.microsoft.com/k8se/quickstart:latest`) for revision `0000002`.
    Deactivate it: `az containerapp revision deactivate --name ca-dev-server
    --resource-group rg-datacore --revision ca-dev-server--0000002`. Otherwise
    `az containerapp exec` may connect to the wrong container.
11. **`az containerapp exec` rate-limits at 200 req/5min.** After repeated
    exec attempts (e.g. restarting replicas), Azure returns 429 with
    `retry-after: 600`. Wait 10 minutes. Use `run_command` via MCP in the
    meantime — it goes through HTTP and has no exec rate limit.
12. **Specify `--revision` when using exec.** Without it, exec may fail
    with "Could not find a replica" if multiple revisions exist. Always pass
    `--revision ca-dev-server--0000001` explicitly.

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

## Documentation Rules

- `azure-dev-server/CLAUDE.md` is the canonical record for this sandbox (commands, deployment targets, gotchas). Other docs point here when referencing this project.
- Before closing work on this repo:
  1. Run `./scripts/check-docs.sh`.
  2. Grep for any values you changed across docs (ports, resource names, test counts). Update or replace duplicates with pointers.
  3. Add `Docs checked: …` to your task log so reviewers know which commands ran.
- When you add or change Azure resource IDs, update the design docs under `docs/azure-dev-server/` and note the date.
- Claude Desktop reruns the same checks during review. Missing documentation proof is an automatic send-back.

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
