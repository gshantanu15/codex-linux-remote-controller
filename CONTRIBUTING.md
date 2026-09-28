# Contributing

## Principles

Changes should remain:

- source-only and independently reviewable;
- fail-closed on unknown Codex layouts;
- explicit about security tradeoffs;
- reversible;
- minimal in privileged scope; and
- free of credentials, profile data, logs, and proprietary OpenAI binaries.

## Development setup

On Ubuntu or Debian:

```bash
sudo apt install build-essential libnode-dev libssl-dev libsecret-1-dev pkg-config dbus-x11 gnome-keyring
```

Run:

```bash
npm test
npm run audit:publication
```

The native test creates a disposable D-Bus session and GNOME Keyring. It must not use a contributor's real desktop keyring.

## Testing a new Codex version

1. Install the new official package normally.
2. Run `npm run inspect` without changing any source.
3. Record which marker or contract check fails.
4. Review the new bundle behavior; do not merely loosen counts or patterns.
5. Update the smallest possible compatibility check.
6. Add or update a synthetic regression test.
7. Run the full test suite.
8. Build an isolated test copy.
9. Complete an end-to-end smoke test against a disposable repository.
10. Document the tested package version and behavior.

Never submit an extracted `app.asar`, official native addon, or binary diff.

## Pull requests

A pull request should explain:

- the observed problem;
- whether behavior is documented, observed, or inferred;
- the security impact;
- tests performed;
- rollback implications; and
- any Codex versions tested.

Keep unrelated refactoring out of compatibility fixes.

## Native code

- Preserve `-Wall -Wextra -Wpedantic -Werror` cleanliness.
- Validate JavaScript inputs before native use.
- Keep blocking work off the Electron main thread.
- Clear temporary private-key buffers.
- Avoid adding private-key export operations.
- Retain owner-only filesystem permissions and no-follow behavior.

## Privileged code

Changes to `bin/official-root-helper.mjs` require special scrutiny. The helper must keep fixed target paths, validate invoking-user ownership and every hash, refuse running app processes, and avoid invoking a shell. Documentation must retain the warning that `pkexec` trusts the user-owned checkout as root.

## Documentation

Use primary sources for platform and API claims. Mark internal Codex behavior as observed rather than supported. Keep installation instructions copy-pasteable and include rollback.

## Before submission

```bash
npm test
npm run audit:publication
git diff --check
```
