# Changelog

All notable project changes are documented here.

## 0.3.1 — 2026-10-08

### Fixed

- Recognize the reviewed `ne` feature-flag function in Codex `26.1002.51308`, while retaining the earlier `he` binding in `26.924.22138`.
- Preserve unique binding/gate checks, same-length edits, and ASAR integrity verification.
- Add regression tests for both bindings, multi-block integrity, ambiguous or missing gates, unreviewed functions, corrupted targets, and already-patched archives.

### Validation status

- All 14 JavaScript regression tests and the disposable native keyring integration test pass.
- Inspection and isolated-copy hash, integrity, and addon-export verification pass for `26.1002.51308` on Linux x86-64.
- Live enrollment and Windows-host reconnection on `26.1002.51308` remain pending; static compatibility does not establish end-to-end support.

## 0.3.0 — 2026-09-28

### Added

- Repeatable official-install, verification, and exact rollback workflows.
- Versioned manifests and SHA-256 validation for original and patched files.
- Narrow `pkexec` root helper with process, path, and hash checks.
- Device-key client contract inspection before official patching.
- Full publication documentation, security policy, CI, and source audit.

### Verified

- Official Codex package `26.924.22138`.
- Linux x86-64 controller enrollment and connection to an official Windows host.
- Official package patch and post-install verification.

## 0.2.0

### Added

- Linux Secret Service device-key provider.
- Native create, public lookup, sign, verify, permission, and deletion tests.
- Isolated test-copy profile and launch workflow.

## 0.1.0

### Added

- Strict renderer gate discovery.
- Same-length controller visibility patch.
- ASAR packed-file and block-integrity regeneration.
