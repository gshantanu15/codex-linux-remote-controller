# References

## OpenAI

- [Remote Connections](https://learn.chatgpt.com/docs/remote-connections) — official user documentation for controlling a host from another supported device.
- [openai/codex issue #28919](https://github.com/openai/codex/issues/28919) — issue that motivated investigation of the missing controller path.
- [Linked issue comment](https://github.com/openai/codex/issues/28919#issuecomment-5600027691) — specific discussion referenced at the start of this experiment.

The issue discussion is context, not a supported Linux interface specification.

## Apple T2 and Secure Enclave

- [Apple T2 Security Chip certifications](https://support.apple.com/guide/certifications/apple-t2-security-chip-certifications-apc3225ccbd21/1/web/1.0)
- [Apple Platform Security: Secure Enclave](https://support.apple.com/guide/security/sec59b0b31ff/web)

These sources describe Apple's hardware security architecture. They do not describe a Linux TPM-compatible device interface.

## Linux TPM

- [Linux kernel TPM documentation](https://www.kernel.org/doc/html/latest/security/tpm/index.html)
- [Linux kernel TPM security documentation](https://www.kernel.org/doc/html/latest/security/tpm/tpm-security.html)
- [t2linux organization](https://github.com/t2linux)
- [t2linux wiki](https://github.com/t2linux/wiki)

## Secret storage

- [Secret Service API specification](https://specifications.freedesktop.org/secret-service/latest-single/)
- [libsecret documentation](https://gnome.pages.gitlab.gnome.org/libsecret/)

The Secret Service specification is the basis for the desktop keyring integration. It does not promise hardware-backed non-exportability.

## Electron and Node

- [Electron ASAR archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Electron ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
- [Node-API documentation](https://nodejs.org/api/n-api.html)

## Cryptography

- [OpenSSL ECDSA signature implementation](https://docs.openssl.org/3.0/man7/EVP_SIGNATURE-ECDSA/)
- [OpenSSL EVP signing API](https://docs.openssl.org/3.0/man3/EVP_DigestSignInit/)

## Interpretation limits

Links to primary sources support platform and API background. Details about Codex's renderer markers, native addon methods, and fallback policy are observations from the tested local package and are not published OpenAI API guarantees.
