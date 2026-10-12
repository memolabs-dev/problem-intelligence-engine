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

Solo-maintainer mode: `@drop-agent-bot` may submit PRs and enable GitHub auto-merge when the required CI checks pass. Human review is optional while branch protection requires zero approvals; the bot must not fabricate approvals or bypass required checks.
