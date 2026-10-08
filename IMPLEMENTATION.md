# Implementation record

This file records the tested implementation at a glance. The `docs/` directory contains the full explanation.

## Observed blockers

The Linux package contained the controller UI and remote connection client, but:

1. a renderer feature gate hid **Control other devices**;
2. the bundled native device-key addon required a usable TPM 2.0 interface; and
3. Electron enrollment state belonged to the active application profile.

The tested T2 Linux machine exposed no `/dev/tpm0` or `/dev/tpmrm0`, so exposing the UI alone led to the message: `Remote control requires a usable TPM 2.0`.

## Renderer patch

`lib/remote-controller-patch.mjs` locates exactly one remote-connections asset and verifies:

- feature flag `782640499`;
- one `showControlOtherDevices` binding;
- one `access-other-devices` entry; and
- one expected disabled or enabled gate.

It changes the same-length expression `we=!m` to `we=!0`, with padding when variable names differ, then recomputes the packed file's SHA-256 and block hashes in the ASAR header. Any ambiguous or changed layout is rejected.

## Native provider

`native/remote_control_device_key.cc` implements the four addon methods observed in the installed application:

- `createDeviceKey(policy)`
- `deleteDeviceKey(keyId)`
- `getDeviceKeyPublic(keyId)`
- `signDeviceKey(keyId, payload)`

It generates P-256 keys, signs with ECDSA/SHA-256, stores private PKCS#8 material through libsecret, and stores public metadata in owner-only files. It accepts `allow_os_protected_nonextractable` and rejects `hardware_only`.

The provider has no export method, but the underlying Secret Service item remains retrievable by sufficiently privileged software in the same desktop session. It is therefore lower assurance than hardware-backed non-exportability.

## Isolation and official installation

The recommended test-copy launcher isolates Chromium/Electron data, `CODEX_HOME`, SQLite data, logs, and singleton state. This prevents the experiment from locking or mutating the official app's profile.

The advanced official workflow:

1. inspects and stages as the desktop user;
2. records package version and original/patched SHA-256 hashes;
3. keeps exact original files in a versioned backup;
4. invokes a purpose-limited root helper for two atomic replacements;
5. verifies installed hashes after replacement; and
6. restores only when the current files match the corresponding patch record.

Updates are expected to overwrite the patch. Re-running `official:install` is the supported repeatable process; unknown layouts fail closed and require review.

Because `pkexec` executes the helper and imported modules from the user-owned checkout, authorization trusts the reviewed checkout as root. The helper's fixed targets, ownership checks, and hashes reduce mistakes and races but do not make untrusted project code safe to authorize.

## Validation completed

- JavaScript archive and client-contract regression tests cover both reviewed flag bindings, integrity preservation, and rejection of ambiguous or corrupted inputs.
- The native integration test passes in a disposable D-Bus/GNOME Keyring session.
- Create, public lookup, sign, external signature verification, empty-payload signing, permissions, and idempotent deletion pass.
- The staged provider loads with exactly the four expected exports.
- Isolated enrollment completed and connected to an official Windows host.
- The official installation was subsequently patched and verified through the separate privileged workflow.

Tested on 2026-09-28 with Codex `26.924.22138`.

## October compatibility update

Codex `26.1002.51308` retains feature flag `782640499` but renames its renderer function from `he` to `ne`. The original inspector's hard-coded function name rejected the updated package before any files were patched. Version `0.3.1` recognizes both reviewed names while preserving uniqueness, same-length replacement, and integrity checks.

The new visibility assignment is `K=!d`, patched to `K=!0`. Synthetic regression fixtures cover both reviewed builds; no extracted application bundle is included in the repository.

Validation for the new package includes 14 JavaScript regression tests, the disposable native keyring integration test, actual-package inspection, and isolated-copy hash, integrity, and four-export verification. The official reapplication workflow remains available for manual validation. Live enrollment, reconnection, and remote task execution on the new version have not yet been confirmed.

## Detailed reading

Start with [Original problem](docs/01-original-problem.md), then follow the numbered documents. Security reviewers should read [Security model](docs/09-security-model.md) and [SECURITY.md](SECURITY.md).
