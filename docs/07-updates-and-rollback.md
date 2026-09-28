# Updates and rollback

## Expected update behavior

The official patch changes two package-managed files:

```text
/usr/lib/chatgpt/resources/app.asar
/usr/lib/chatgpt/resources/native/remote-control-device-key.node
```

A Codex package update is expected to replace both. The immediate result is normally:

- **Control other devices** becomes hidden again; and
- the original TPM-only addon returns.

User profile data and Secret Service state live outside `/usr/lib/chatgpt` and should remain, but this is not a promise that enrollment will survive every future application or service change.

## After every update

Do not copy an old patched ASAR over a new release. Run:

```bash
npm run official:verify
npm test
npm run inspect
npm run official:install
npm run official:verify
```

Then complete a live reconnection or enrollment smoke test.

The installer identifies the package version from `resources/owl-app.ini` and creates a new versioned install record. It does not trust an earlier version's hashes.

## Compatibility gates

A new version is accepted only when the tooling can still verify:

- exactly one target renderer asset;
- the expected feature flag binding;
- one `showControlOtherDevices` binding;
- one `access-other-devices` entry;
- a same-length gate replacement;
- valid original and patched ASAR integrity;
- one main bundle loading the device-key addon;
- every required device-key client marker; and
- exactly four exports from the replacement addon.

These checks catch structural changes. They cannot prove that unchanged names still have unchanged semantics.

## Why patching is not automatic

An unattended package-manager hook would have to run privileged modifications immediately after receiving unfamiliar code. That removes two useful safety boundaries:

1. a person reviews whether the new package still matches the known contract; and
2. administrator authorization is granted for one explicit replacement.

A notification hook may report that `official:verify` no longer passes. Reapplication should remain explicit.

## Backup layout

Official install records live below:

```text
~/.local/share/codex-linux-remote-controller-test/official-installs/
```

Each accepted install retains:

- the exact original ASAR;
- the exact original native addon;
- a manifest containing source and patched SHA-256 hashes;
- package version and contract evidence; and
- an apply or restore result.

The ASAR backup may consume several hundred megabytes per version. Remove an old record only after that package version is no longer installed and you no longer need its exact rollback.

Do not publish this state directory. It contains proprietary OpenAI binaries.

## Normal rollback

Close every Codex process and run:

```bash
npm run official:restore
```

The root helper validates:

- it is running as root;
- target paths are the expected official paths;
- staged paths remain inside the manifest directory;
- the current official files match the recorded patched hashes; and
- the backup files match their original hashes.

Only then are the originals restored atomically.

## When rollback refuses

Refusal is expected if:

- Codex is still running;
- the package manager has already installed a new version;
- one official file was changed independently;
- the manifest or backup is missing;
- current hashes do not match the install record; or
- the target paths are unexpected.

Do not bypass these checks. Reinstall the current official Codex package, then inspect that clean version again.

## Recovery hierarchy

Use this order:

1. `npm run official:verify` to identify current state.
2. `npm run official:restore` when hashes match an applied record.
3. Reinstall the official package when state is unknown.
4. Re-run tests and inspection before attempting a fresh patch.

Never restore a backup from a different Codex version.
