# Contributing

Contributions are welcome when they preserve Ciphora's local-first security model and existing product style.

## Development Workflow

1. Fork the repository.
2. Create a focused branch for one logical change.
3. Install dependencies with `npm install`.
4. Run the relevant checks before opening a pull request.

Recommended baseline:

```bash
npm run typecheck
npm run typecheck:functions
npm run build
```

## Pull Request Expectations

- Keep changes focused and reviewable.
- Do not mix unrelated refactors with feature or bugfix work.
- Document behavior changes that affect vault data, auth, sync, recovery, or deployment.
- Add or update tests/smoke coverage when practical.
- Never commit secrets, local tokens, keystores, browser vault exports, or private debug payloads.

## Security-Sensitive Changes

Changes touching authentication, recovery, encryption, session handling, provider sync, database schemas, or secret handling require extra care. Explain the threat model impact and rollback path in the pull request.
