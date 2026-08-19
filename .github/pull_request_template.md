## What

Short description of the change.

## Why

Why is this needed? Link an issue if one exists.

## How to test

Steps a reviewer (or you) can run to verify:

```bash
npm run typecheck && npm test && npm run build
cd extensions/pi && npm run typecheck && npm run build
```

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes (root and `extensions/pi`)
- [ ] No new runtime dependencies added without reason
- [ ] Docs updated if behavior changed (README.md, docs/, CONTRIBUTING.md)
