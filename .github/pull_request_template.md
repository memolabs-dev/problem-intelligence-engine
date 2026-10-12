## Why

Describe the user problem or defect this PR addresses. Link a reproducible source or issue when possible.

## Changes

Summarize the implementation and any schema or data migration.

## Evidence safety

- [ ] Sources and evidence excerpts are linked and traceable.
- [ ] No inference of independent users, payment, or market validation from raw volume.
- [ ] No secrets, local reports, model credentials, or temporary files committed.

## Validation

- [ ] `npm test` passed locally.
- [ ] PostgreSQL integration tests passed (`PIE_INTEGRATION=1 npm test`).
- [ ] GitHub Actions checks passed on supported Node.js versions.

## Review

Human code-owner approval is required. `@drop-agent-bot` may submit or update changes, but must not auto-approve its own PR.
