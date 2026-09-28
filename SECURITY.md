# Security policy

## Project status

This project is experimental and unofficial. It modifies local Codex desktop files and intentionally substitutes a lower-assurance Linux Secret Service key provider for a TPM-backed provider.

Only the current `main` branch is maintained. There is no guarantee of compatibility with any Codex release.

## Reporting a vulnerability

Do not open a public issue for a vulnerability, credential exposure, or report containing private account or device data.

After this repository is published, use GitHub's private vulnerability reporting or open a private security advisory for the repository. If private reporting is not enabled, contact the repository owner privately through their published GitHub contact method before sharing technical details.

Include:

- affected project revision;
- Codex package version;
- distribution and architecture;
- attack prerequisites;
- security impact;
- minimal reproduction steps; and
- a suggested mitigation, if known.

Do not include real access tokens, cookies, keyring exports, private keys, proprietary Codex binaries, or unsanitized profile data.

## In scope

- Native memory-safety or key-handling defects.
- Secret Service item exposure beyond the documented same-user threat.
- Path traversal, symlink, or permission vulnerabilities.
- ASAR parser or patcher vulnerabilities.
- Privilege escalation or arbitrary file replacement through the root helper.
- Rollback behavior that can overwrite an unrelated package version.
- Publication tooling that leaks credentials or proprietary binaries.

## Known and accepted limitations

The following are documented design limitations rather than undisclosed vulnerabilities:

- Secret Service keys are not TPM-backed or physically non-exportable.
- Same-user malware with access to an unlocked Secret Service may retrieve stored material.
- Root can access or modify application and user state.
- Internal Codex bundle markers and native contracts may change without notice.
- Package updates overwrite the patch.
- The project provides no hardware attestation.

See [Security model](docs/09-security-model.md) for trust boundaries and residual risks.

## Response expectations

This is a volunteer experimental project. Reports will be acknowledged and triaged when maintainers are available. A security-sensitive release should include a clear impact statement, affected versions, mitigation, and credit when desired.
