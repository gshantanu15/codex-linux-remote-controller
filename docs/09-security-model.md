# Security model

## Security objective

Enable the observed OS-protected controller-key fallback on Linux while preserving normal ChatGPT authentication, authorization, remote-host permissions, and explicit local installation consent.

The project does not claim TPM-equivalent assurance.

## Assets

- ChatGPT session and authorization state.
- Controller private key.
- Controller public-key metadata and enrollment identity.
- Official Codex package files.
- Versioned rollback copies.
- Remote Windows host and repositories accessible through it.

## Trust boundaries

```mermaid
flowchart TD
    U[Desktop user] --> E[Patched Electron app]
    E --> N[Native device-key addon]
    N --> S[Secret Service]
    E --> R[ChatGPT remote connection service]
    R --> H[Official Windows host]
    P[Privileged root helper] --> O[/usr/lib/chatgpt]
    I[Unprivileged installer] --> P
```

- The Electron renderer and main process are trusted to request legitimate signatures.
- The native addon is trusted with private-key bytes while signing.
- The desktop Secret Service and unlocked user session are trusted to protect stored secret material.
- The root helper is trusted to replace only two validated package files.
- OpenAI's service and official Windows host remain outside this project's control.

## Threats and mitigations

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Wrong bundle target patched | Unique path and marker checks | Semantics can change while markers remain |
| Corrupt ASAR | Original integrity verification, same-length edit, recomputed hashes, reopen verification | Future Electron integrity behavior may change |
| Package changes during staging | Hash before and after copy/preparation | Privileged local attacker can defeat user-space checks |
| Arbitrary privileged replacement | Purpose-limited helper, fixed targets, invoking-user checks, private staged files, post-copy hashes | `pkexec` executes user-owned project code as root; the reviewed checkout must be trusted and protected |
| Partial official install | Atomic replacement and automatic rollback attempt | Power loss or filesystem failure can still require reinstall |
| Old backup over new package | Restore requires current patched hashes | Lost records require package reinstall |
| Private key exposed to JavaScript | Four-method addon API has no export function | Compromised native addon or process memory can expose it |
| Private key read by another process | Secret Service access control and desktop session | Same-user malware or root may retrieve the secret |
| Silent update incompatibility | Contract markers and fail-closed checks | Markers are not a formal protocol specification |
| Test corrupts official profile | Isolated user-data, Codex, SQLite, config, and log paths | Secret Service remains shared by design |

## Key assurance

The provider gives stronger handling than a plain unprotected key file:

- secret storage is delegated to the desktop Secret Service;
- private bytes are not written to the metadata directory;
- private bytes do not cross the JavaScript API;
- signing happens in native code; and
- temporary native buffers are cleared.

It gives weaker assurance than a TPM, Secure Enclave, or hardware-backed PKCS#11 token:

- the Secret Service value is retrievable;
- the key is not cryptographically bound to this machine's T2 chip;
- there is no hardware attestation;
- there is no measured boot dependency; and
- a compromised logged-in session may access the unlocked keyring.

## Profile isolation

The isolated profile is a containment control, not a cryptographic control. It separates:

- cookies and authentication storage;
- Chromium local state;
- singleton locks;
- Codex configuration;
- SQLite data;
- enrollment metadata; and
- launcher logs.

Using the existing official profile removes this containment and should occur only after isolated validation.

## Privilege model

Normal inspection, build, tests, and staging run as the desktop user. Only the final official-file replacement and restore run as root through `pkexec`.

Node loads the helper and its imported modules from the user-owned checkout. Approving `pkexec` therefore grants root execution to the reviewed checkout. The checks below constrain the intended helper path and protect against common staging mistakes and races; they are not a privilege sandbox for malicious or concurrently modified project source.

The helper refuses:

- non-root execution;
- unexpected operations;
- a missing or mismatched `PKEXEC_UID`;
- unexpected target paths;
- staged paths outside the manifest directory;
- manifests, backups, or candidates with unsafe ownership or permissions;
- mismatched source, staged, or backup hashes; and
- execution while official Codex processes are running.

The project should never be run wholesale with `sudo`.

## Out of scope

- Protecting a fully compromised root account.
- Protecting an unlocked user session from same-user malware.
- Providing or emulating TPM attestation.
- Reverse-engineering or bypassing ChatGPT authorization.
- Weakening remote host approvals or sandboxing.
- Guaranteeing service or package compatibility.
- Supporting redistribution of OpenAI binaries.

## Operational guidance

- Review source before granting `pkexec` authorization.
- Use the isolated test copy first.
- Keep the official package source available for reinstall.
- Re-run tests after every Codex update.
- Do not auto-patch unknown versions.
- Use a disposable repository for initial remote write tests.
- Remove old proprietary backups when no longer needed.

## Security improvements worth exploring

1. A PKCS#11 backend using a genuinely non-exportable hardware token.
2. Reproducible native-addon builds and published source-build attestations.
3. Additional fuzzing of ASAR parsing and native input handling.
4. A read-only compatibility report for new Codex versions.
5. Independent review of the native provider and privileged helper.
