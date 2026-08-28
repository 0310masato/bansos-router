# AGENTS.md

## Repository scope

This checkout is exclusively for the personal `bansos-router` fork.

- Expected writable GitHub repository: `0310masato/bansos-router`.
- The upstream `ihsan-ramadhan/bansos-router` remote is read-only unless the user explicitly requests an upstream contribution.
- Do not inspect, edit, test, commit, or publish sibling projects from this checkout.
- Kindle, screen capture, OCR, image-to-PDF, and `kindle-capture-local` work belongs in its dedicated project and task. Stop and redirect cross-project requests instead of switching directories.

## Write preflight

Before editing, committing, merging, rebasing, tagging, or pushing:

1. Confirm `git rev-parse --show-toplevel` is this Bansos checkout.
2. Confirm the writable remote resolves to `0310masato/bansos-router`.
3. Report the current branch and whether the worktree is clean.
4. Confirm every planned path is inside this repository.
5. Stop on any repository, remote, branch, or task mismatch.

Do not continue a Bansos change from a shared parent workspace or from a Kindle task.

## Security boundaries

- Preserve strict security mode, loopback-only defaults, relay blocking, upstream allowlists, cross-provider failover controls, secret guarding, and metadata-only logging.
- Never put API keys, tokens, credentials, prompts, tool output, or raw provider error bodies in source, fixtures, logs, commits, or test output.
- Do not send test requests to real external LLM providers. Use loopback-only mocks.
- Do not weaken security behavior to make a test pass.

## Validation

Run before committing code changes:

```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

For documentation-only boundary changes, `git diff --check` is the minimum required check.
