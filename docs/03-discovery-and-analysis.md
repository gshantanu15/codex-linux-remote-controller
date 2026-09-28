# Discovery and analysis

## Scope

The analysis targeted only the locally installed Linux desktop package. It did not intercept service traffic, bypass authentication, or modify the Windows host.

The package layout contained:

```text
/usr/lib/chatgpt/
└── resources/
    ├── app.asar
    └── native/
        └── remote-control-device-key.node
```

## Finding the controller UI

The ASAR contained a renderer asset matching:

```text
webview/assets/remote-connections-settings-<hash>.js
```

That asset contained all of the following:

- the numeric feature flag `782640499`;
- a `showControlOtherDevices` property;
- an `access-other-devices` setup entry; and
- the labels and dialog used by the controller flow.

This established that the Linux package shipped the interface but disabled its visibility.

## Finding the device-key client

The main Electron bundle loaded:

```text
remote-control-device-key.node
```

The observed JavaScript client referenced:

- `createDeviceKey`
- `deleteDeviceKey`
- `getDeviceKeyPublic`
- `signDeviceKey`
- `allow_os_protected_nonextractable`
- `os_protected_nonextractable`
- `signedPayloadBase64`
- `signatureDerBase64`

`lib/device-key-contract.mjs` checks that exactly one main bundle loads the addon and that every required marker remains present. This is a compatibility tripwire, not proof that the entire internal protocol is unchanged.

## Reconstructing the addon contract

The replacement was constrained to the smallest surface the installed app used:

| Method | Input | Observed output or behavior |
| --- | --- | --- |
| `createDeviceKey` | Protection policy | Key identifier, algorithm, protection class, SPKI public key |
| `getDeviceKeyPublic` | Key identifier | Existing public metadata |
| `signDeviceKey` | Key identifier and byte payload | DER ECDSA signature and algorithm metadata |
| `deleteDeviceKey` | Key identifier | Idempotent deletion |

The client serialized the payload before calling the addon. The provider therefore signs exactly the supplied bytes with ECDSA P-256 and SHA-256; it does not reinterpret protocol fields.

## What was not established

The following should not be treated as stable public API guarantees:

- feature flag `782640499`;
- bundle filenames and minified variable names;
- the four-method native addon ABI;
- enrollment payload structure;
- server acceptance rules; and
- the continued availability of the OS-protected fallback.

The current installer compensates with structural checks and fails closed. A future Codex update may still preserve all markers while changing semantics, which is why a live smoke test remains mandatory.

## Why server acceptance mattered

Static inspection showed that the client requested an OS-protected fallback, but could not prove that the service would accept a non-TPM Linux controller.

The end-to-end test established only the following for the tested version and account:

1. the provider's public key representation was accepted;
2. signatures produced by the provider passed enrollment;
3. authorization completed; and
4. the Windows host appeared connected.

It does not establish an official service contract or future compatibility.

## Safety decisions from the analysis

- Patch exactly one known renderer target.
- Keep the packed asset length unchanged.
- Recompute and verify ASAR integrity metadata.
- Build the native provider from source.
- Reject `hardware_only`.
- Avoid publishing any OpenAI binary or extracted bundle.
- Test in an isolated profile before modifying the official installation.
- Record hashes and exact originals for rollback.
- Stop on unknown versions rather than guessing.
