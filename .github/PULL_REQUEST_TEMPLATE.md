## Summary

Describe the problem and the smallest change that solves it.

## Evidence

- [ ] Documented by a linked primary source
- [ ] Observed in a locally installed Codex package
- [ ] Inferred from behavior and clearly labeled as such

## Security impact

Describe changes to key handling, profiles, privileged operations, package files, or rollback.

## Validation

- [ ] `npm test`
- [ ] `npm run audit:publication`
- [ ] `git diff --check`
- [ ] Isolated test-copy verification, when applicable
- [ ] End-to-end smoke test, when applicable

## Publication boundary

- [ ] No OpenAI binaries or extracted proprietary bundle content
- [ ] No credentials, account identifiers, private device names, profile data, or unsanitized logs
- [ ] New Codex versions retain strict fail-closed checks

## Rollback

Explain how a user returns to the exact pre-change state.
