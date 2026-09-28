# Architecture

## Components

```mermaid
flowchart LR
    subgraph Linux controller
        UI[Remote Connections UI]
        MAIN[Electron main process]
        ADDON[Replacement Node-API addon]
        META[Public metadata]
        KEYRING[Secret Service]
        UI --> MAIN
        MAIN --> ADDON
        ADDON --> META
        ADDON --> KEYRING
    end

    MAIN --> SERVICE[ChatGPT remote connection service]
    SERVICE --> HOST[Official Codex app on Windows]
```

### Renderer patcher

Reads `app.asar`, finds one known remote-connections asset, enables its existing visibility gate, updates packed-file integrity metadata, and verifies the result.

### Contract inspector

Finds the main bundle that loads `remote-control-device-key.node` and verifies the markers used by the observed JavaScript client.

### Native provider

Implements the minimal four-method asynchronous Node-API surface and performs P-256 key generation and signing with OpenSSL.

### Secret Service

Stores the serialized private key in the logged-in user's desktop keyring. It is a shared desktop service, even when the app profile is isolated.

### Public metadata store

Stores only key identifier, protection class, algorithm, and public-key data under `$CODEX_HOME` with owner-only permissions.

### Test-copy installer and launcher

Copies the complete app into user storage, applies both changes, records hashes, verifies the staged application, and launches it with isolated profile paths.

### Official installer and root helper

Stages and validates without privileges. A purpose-limited helper performs the validated official-file replacements or restoration after explicit `pkexec` authorization. Because Node loads it from the user-owned checkout, authorization trusts the reviewed checkout as root; helper checks are defense in depth rather than isolation from malicious project code.

## Enrollment sequence

```mermaid
sequenceDiagram
    participant User
    participant Linux as Patched Linux Codex
    participant Addon as Secret Service addon
    participant Service as ChatGPT service
    participant Windows as Official Windows host

    User->>Linux: Start Control other devices setup
    Linux->>Addon: createDeviceKey(allow_os_protected_nonextractable)
    Addon->>Addon: Generate P-256 key
    Addon-->>Linux: key ID and SPKI public key
    Linux->>Service: Begin authorization and enrollment
    Service-->>User: Account authorization
    Service->>Linux: Signing challenge
    Linux->>Addon: signDeviceKey(key ID, payload)
    Addon-->>Linux: DER ECDSA signature
    Linux->>Service: Complete enrollment
    Windows->>Service: Host connection
    Service-->>Linux: Connected host
```

The exact service payloads are internal and intentionally not reimplemented by this project.

## Test-copy installation sequence

```mermaid
sequenceDiagram
    participant Tool as Unprivileged installer
    participant Official as /usr/lib/chatgpt
    participant Stage as User-owned test copy

    Tool->>Official: Read version and hashes
    Tool->>Stage: Copy complete application
    Tool->>Stage: Enable renderer gate
    Tool->>Stage: Install source-built addon
    Tool->>Official: Recheck source hashes
    Tool->>Stage: Verify hashes and contract
    Tool-->>Stage: Write manifest and current link
```

## Official installation sequence

```mermaid
sequenceDiagram
    participant Tool as Unprivileged installer
    participant Record as Versioned install record
    participant Auth as pkexec
    participant Helper as Root helper
    participant Official as /usr/lib/chatgpt

    Tool->>Official: Inspect contract and hash files
    Tool->>Record: Copy originals and candidates
    Tool->>Record: Patch candidate and write manifest
    Tool->>Official: Recheck unchanged source hashes
    Tool->>Auth: Request explicit authorization
    Auth->>Helper: Run one apply operation
    Helper->>Record: Validate paths and hashes
    Helper->>Official: Atomically replace ASAR
    Helper->>Official: Atomically replace addon
    Helper->>Official: Verify installed hashes
    Helper-->>Record: Write applied result
```

## State locations

| State | Location | Contains proprietary binary |
| --- | --- | --- |
| Project source | Git working tree | No |
| Native build output | `build/` | No, but generated and ignored |
| Test application | `~/.local/share/codex-linux-remote-controller-test/versions/` | Yes |
| Isolated profiles | `~/.local/share/codex-linux-remote-controller-test/profiles/` | User data |
| Official rollback records | `~/.local/share/codex-linux-remote-controller-test/official-installs/` | Yes |
| Public key metadata | `$CODEX_HOME/device-keys-os-protected-v1/` | No private key |
| Private key | Desktop Secret Service | Yes |

Only the project source belongs in Git.
