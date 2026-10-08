# Renderer gate patch

## Purpose

The renderer patch exposes an interface already shipped in the Linux package. It does not add a new page or reimplement the remote connection client.

## Target selection

`inspectRemoteControllerGate` reads the ASAR header and requires exactly one packed file matching:

```text
webview/assets/remote-connections-settings-<hex hash>.js
```

It then requires exactly one occurrence of each structural marker:

- a binding to feature flag `782640499` through a reviewed function name (`he` or `ne`);
- `showControlOtherDevices:<variable>`;
- the `access-other-devices` entry; and
- either the disabled or enabled gate expression.

An absent or duplicate marker aborts the patch.

## Same-length replacement

In the tested minified asset, the disabled assignment was:

```js
we=!m
```

The enabled assignment is:

```js
we=!0
```

The implementation derives the actual minified variable names and pads with spaces when necessary. The replacement must have exactly the same byte length as the original.

Keeping the packed file length constant avoids rewriting ASAR offsets for every later packed entry. Only the target bytes and integrity metadata need to change.

## Codex 26.1002.51308 compatibility

The updated renderer calls `ne` rather than `he` for feature flag `782640499` and assigns its result to `d`. The visibility property refers to `K`, whose disabled assignment is `K=!d`; the same-length enabled assignment is `K=!0`.

The inspector accepts these two reviewed function names and still derives the flag and visibility variable names from the bundle. Other function names, duplicate bindings, missing or ambiguous gates, and invalid integrity metadata are rejected. These are structural compatibility checks, not a reviewed-version allowlist or proof of unchanged service behavior. Live enrollment or reconnection must be tested separately.

## ASAR integrity update

Electron ASAR entries may include:

- a SHA-256 hash for the complete packed file;
- a block size; and
- SHA-256 hashes for each block.

Changing the renderer bytes invalidates those values. The patch:

1. verifies the original file and block hashes;
2. writes the same-length gate replacement in memory;
3. computes the new complete-file and block hashes;
4. replaces the corresponding hash strings in the fixed-size ASAR header;
5. parses the modified header as JSON;
6. writes a staged ASAR; and
7. reopens the result and verifies the enabled gate and integrity.

See Electron's [ASAR integrity documentation](https://www.electronjs.org/docs/latest/tutorial/asar-integrity) and [ASAR archive documentation](https://www.electronjs.org/docs/latest/tutorial/asar-archives).

## Why this is safer than a generic search-and-replace

A generic text replacement could silently patch:

- the wrong asset;
- multiple unrelated expressions;
- a newer feature with a similar name; or
- an update whose bundle semantics changed.

This tool verifies structure, uniqueness, exact lengths, and integrity before accepting a candidate. A changed required pattern stops installation for review. A new version that retains all recognized patterns can still pass; these checks are not a reviewed-version allowlist.

## What the patch does not prove

Successful ASAR verification proves that the archive is internally consistent and the expected gate is enabled. It does not prove:

- that the remote connection service will authorize the account;
- that the native key contract is unchanged;
- that the host is reachable;
- that OpenAI supports the modified build; or
- that Electron or the package manager accepts all local modifications indefinitely.

Those concerns are covered by contract checks, native tests, post-install verification, and an end-to-end smoke test.
