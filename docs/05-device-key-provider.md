# Secret Service device-key provider

## Purpose

The original Linux addon failed when it could not access a usable TPM 2.0 device. The replacement implements the installed client's observed OS-protected fallback contract with Linux desktop facilities.

Source: `native/remote_control_device_key.cc`.

## Build and ABI

The provider is a C++ Node-API addon built with:

- Node-API version 8;
- OpenSSL 3;
- libsecret; and
- GLib/GIO dependencies supplied through libsecret.

Node-API is used because it provides an ABI-stable interface across supported Node.js versions. The addon must still be tested with the Electron runtime shipped by the installed Codex package.

## Key lifecycle

### Create

`createDeviceKey(policy)`:

1. rejects `hardware_only` with a usable-TPM error;
2. accepts `allow_os_protected_nonextractable`;
3. generates an EC key on the NIST P-256 curve;
4. exports the public key as SPKI;
5. serializes the private key as PKCS#8 for Secret Service storage;
6. creates an opaque key identifier;
7. stores the private value through libsecret;
8. writes public metadata to an owner-only file; and
9. clears temporary private buffers.

### Lookup

`getDeviceKeyPublic(keyId)` reads public metadata and returns the identifier, algorithm, protection class, and SPKI public key. It does not query or return the private value.

### Sign

`signDeviceKey(keyId, payload)`:

1. bounds-checks the byte payload;
2. retrieves the corresponding Secret Service value;
3. parses the PKCS#8 key in native memory;
4. signs the exact payload using ECDSA P-256 with SHA-256;
5. returns a DER-encoded signature; and
6. clears temporary key material.

### Delete

`deleteDeviceKey(keyId)` removes both the Secret Service item and public metadata. Repeating deletion is intentionally safe.

## Storage

Private material is stored as a Secret Service item in the current desktop session. Public metadata lives below:

```text
$CODEX_HOME/device-keys-os-protected-v1/
```

The provider enforces:

- `0700` on the metadata directory;
- `0600` on metadata and lock files;
- no-follow behavior for sensitive filesystem operations;
- temporary-file plus rename behavior for metadata; and
- serialized updates through a lock file.

## Protection class

The provider reports:

```text
os_protected_nonextractable
```

This accurately describes the exposed addon API: JavaScript can create, inspect the public key, sign, and delete, but cannot export the private key.

It does **not** mean Secret Service transformed the key into hardware-bound, physically non-exportable material. The [Secret Service specification](https://specifications.freedesktop.org/secret-service/latest-single/) defines user-session secret storage; it does not guarantee TPM-equivalent resistance to a compromised user session.

## Threading and errors

Cryptographic and Secret Service work runs as asynchronous Node-API work instead of blocking the Electron main thread. Native exceptions are converted into rejected JavaScript promises.

Inputs are validated for:

- supported policy;
- required key identifiers;
- Buffer or Uint8Array payload type;
- payload size;
- key existence; and
- expected stored metadata.

## Tests

The native integration test launches a disposable D-Bus session and GNOME Keyring, then verifies:

- all four expected exports;
- rejection of `hardware_only`;
- creation under the fallback policy;
- public-key consistency;
- non-empty and empty-payload signing;
- external ECDSA signature verification;
- owner-only metadata permissions;
- deletion; and
- idempotent deletion.

## Alternatives not used

- **Software TPM:** would create a TPM-shaped software boundary but still lack hardware protection and add daemon/state complexity.
- **PKCS#11 token:** could provide stronger non-exportability when backed by appropriate hardware, but no universal configured token was available.
- **T2 Secure Enclave port:** a separate kernel, firmware-protocol, and security research project.
- **Plain file key:** simpler, but weaker than a locked desktop Secret Service and easier to mishandle.

Future work could add a genuinely non-exportable PKCS#11 backend while preserving the same four-method contract.
