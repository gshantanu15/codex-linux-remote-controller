# Original problem

## Goal

Use the Codex desktop app on a Linux laptop as a controller for an official Codex desktop app running on Windows.

OpenAI documents Remote Connections for supported desktop platforms, with the controlled computer configured through **Control this PC** and another signed-in device acting as the controller. Linux is not listed as a supported controller platform in the current documentation: [OpenAI Remote Connections](https://learn.chatgpt.com/docs/remote-connections).

## Starting observation

The installed Linux package did not show **Control other devices** in **Settings → Connections**. Inspection showed that the relevant page, labels, enrollment dialog, and remote connection client were already present in the shipped application bundle. A renderer feature flag hid the controller tab.

This meant the first problem was not a missing Linux UI implementation. It was a disabled UI path.

## Why exposing the UI was insufficient

After enabling the existing renderer gate, the complete controller interface appeared. Starting setup then produced:

> Remote control requires a usable TPM 2.0; ask your administrator to check TPM availability and access

That message came from the bundled native device-key path. The tested Linux machine had an Apple T2 chip, but exposed neither `/dev/tpm0` nor `/dev/tpmrm0`. The Linux addon therefore had no usable TPM interface.

The investigation identified three independent blockers:

| Layer | Observed problem | Required fix |
| --- | --- | --- |
| Renderer | Controller tab hidden by a feature gate | Enable the existing gate and preserve ASAR integrity |
| Native key provider | Addon treated the machine as lacking a usable TPM | Implement the app's observed OS-protected fallback contract |
| Application profile | Enrollment, cookies, databases, and singleton state are profile-bound | Isolate the test copy or deliberately patch the official profile's app |

## Why a separate profile was required for testing

Electron and Chromium do not derive all state from `XDG_CONFIG_HOME` alone. The official app also owns a Chromium user-data directory, singleton lock, authentication storage, enrollment state, local databases, and Codex-specific data.

Launching a modified test binary against the same profile as the official binary risks:

- preventing one process from starting because of singleton locking;
- mixing cookies and authentication state between experimental and official builds;
- placing enrollment metadata in one profile while the corresponding public key metadata is in another;
- corrupting or migrating a live profile with an untrusted test build; and
- making rollback results impossible to interpret.

The test launcher therefore supplies a dedicated `--user-data-dir` and separate Codex, SQLite, configuration, and log locations. The desktop Secret Service remains shared because it is the normal user-session security service.

The isolated profile was not a workaround for the TPM error. It was a safety boundary that made the TPM replacement testable without modifying the official profile.

## Investigation origin

The initial clue came from [openai/codex issue #28919](https://github.com/openai/codex/issues/28919) and the [specific linked comment](https://github.com/openai/codex/issues/28919#issuecomment-5600027691). The implementation in this repository was then derived from local package inspection, strict marker checks, native contract tests, and an end-to-end controller-to-host connection.

## Evidence labels used in this documentation

To avoid overstating unsupported behavior:

- **Documented** means supported by a linked primary source.
- **Observed** means reproduced in the tested Codex package or machine.
- **Inferred** means a conclusion from bundle behavior that OpenAI has not published as a stable interface.

The native addon contract and renderer markers are observed internal interfaces. They may change without notice.

## Successful outcome

The isolated Linux copy:

1. displayed **Control other devices**;
2. generated and stored an OS-protected device key;
3. completed ChatGPT web authorization;
4. enrolled the controller; and
5. showed an official Windows Codex host as connected.

The Windows host required no binary modification. It used the official app, the same ChatGPT account, and the standard **Control this PC** setup.
