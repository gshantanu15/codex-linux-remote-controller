# Linux, TPM, and Apple T2 background

## The important distinction

An Apple T2 chip and a TPM 2.0 device are both security hardware, but they are not interchangeable interfaces.

Apple describes T2 as an Apple SoC containing a Secure Enclave and Secure Key Store. Linux TPM software normally talks to a TPM through the kernel's TPM subsystem and device nodes such as `/dev/tpm0` or the resource-manager interface `/dev/tpmrm0`.

On the tested machine:

```text
Apple T2 hardware present
          ≠
usable Linux TPM 2.0 character device
```

The bundled Codex addon cared about the second condition.

## What was observed

The test machine was an Intel Mac with Apple T2 hardware running Linux. Hardware inspection and the T2-enabled kernel confirmed the platform, but:

```bash
ls -l /dev/tpm0 /dev/tpmrm0
```

reported no such devices. As a result, the original native addon returned the usable-TPM error when controller enrollment requested a device key.

This is a statement about the tested software stack, not a universal claim that no T2-related Linux development exists.

## Why this project did not port a T2 driver

A credible Secure Enclave driver would require much more than creating a character device with the right name. It would need to understand and safely implement:

- communication with the T2/Secure Enclave firmware;
- key generation and lifecycle commands;
- access control and user-presence semantics;
- signing and public-key extraction behavior;
- reset, sleep, suspend, and failure recovery;
- firmware-version compatibility;
- isolation from hostile kernel and user-space inputs; and
- a stable API consumed by the application.

Exposing a fake `/dev/tpm0` without TPM semantics would be unsafe and would not provide real hardware attestation or non-exportability. Translating Secure Enclave operations into full TPM 2.0 behavior would also be a separate compatibility and security project.

The [t2linux organization](https://github.com/t2linux) contains important Linux-on-T2 work, but this project does not claim that its kernel and platform support expose Apple's Secure Enclave as a standard TPM.

## The path chosen here

Inspection of the installed Codex client found two protection policies:

- `hardware_only`
- `allow_os_protected_nonextractable`

The replacement provider:

- rejects `hardware_only` because it cannot honestly provide TPM-backed protection;
- accepts `allow_os_protected_nonextractable`;
- generates an ECDSA P-256 key;
- stores the private PKCS#8 value through the desktop Secret Service; and
- exposes no JavaScript key-export operation.

This follows the fallback requested by the observed client instead of pretending the T2 is a TPM.

## What “OS-protected nonextractable” means here

The addon's API never returns the private key to JavaScript. Signing occurs inside the native addon after retrieving the Secret Service item.

However, the Secret Service stores a retrievable secret. A malicious same-user process with access to the unlocked session service, or root, may be able to extract it. The implementation is therefore:

- protected by the desktop session and keyring;
- non-exportable through the addon's four-method API; but
- not physically non-exportable in the TPM/Secure Enclave sense.

That distinction is central to the security model.

## Relevant primary references

- [Apple T2 Security Chip certifications](https://support.apple.com/guide/certifications/apple-t2-security-chip-certifications-apc3225ccbd21/1/web/1.0)
- [Apple Platform Security: Secure Enclave](https://support.apple.com/guide/security/sec59b0b31ff/web)
- [Linux kernel TPM documentation](https://www.kernel.org/doc/html/latest/security/tpm/index.html)
- [Secret Service API specification](https://specifications.freedesktop.org/secret-service/latest-single/)
- [libsecret documentation](https://gnome.pages.gitlab.gnome.org/libsecret/)
