# Troubleshooting

## Start with verification

Run the checks that match your installation:

```bash
npm run inspect
npm test
npm run verify
npm run official:verify
```

Do not start by manually replacing files. The verification output identifies whether the installed package, test copy, native provider, or official patch record has changed.

## “Remote control requires a usable TPM 2.0”

This normally means the original TPM-only addon is active.

Check:

1. Did `npm run verify` or `npm run official:verify` pass?
2. Was Codex restarted after applying the patch?
3. Did a package update restore the official addon?
4. Are you launching the staged executable rather than the official executable?
5. Does the installed native addon hash match the manifest?

Do not create fake TPM device nodes. They do not provide TPM semantics.

## The controller tab is missing

Likely causes:

- the official package was updated;
- the unpatched app is running;
- the ASAR replacement did not complete;
- the renderer layout changed; or
- a running process retained the old bundle.

Close Codex, run the applicable verify command, and reinstall only after `npm test` and `npm run inspect` pass.

## Inspection reports zero feature-flag bindings after an update

The error `Expected one 782640499 feature-flag binding, found 0` means the renderer no longer matches a recognized binding. It does not by itself establish that the feature flag or controller UI was removed.

Codex `26.1002.51308` renamed the feature-flag function from `he` to `ne`; project version `0.3.1` recognizes this reviewed change. Update the project checkout before inspecting that package again:

```bash
git pull --ff-only
npm test
npm run inspect
```

If tests and inspection pass, close every Codex process and use `npm run official:install`, followed by `npm run official:verify`. Restart the app and manually confirm the Windows host reconnects and a harmless remote task succeeds. Structural verification alone is not an end-to-end test.

If inspection still fails, stop and report the package version and sanitized error. Do not remove uniqueness checks, accept arbitrary function names, or copy an old patched archive over the updated release.

## Secret Service or keyring errors

The provider requires an active desktop session service.

Check:

```bash
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS"
secret-tool store --label='temporary test' application codex-linux-remote-controller-test
secret-tool lookup application codex-linux-remote-controller-test
secret-tool clear application codex-linux-remote-controller-test
```

Enter a disposable value when `secret-tool store` prompts. If these commands fail:

- verify GNOME Keyring or another Secret Service implementation is installed;
- confirm the keyring is unlocked;
- launch from the graphical user session rather than a bare remote shell;
- do not run the desktop app with `sudo`; and
- inspect desktop keyring logs.

## Native build fails

On Ubuntu or Debian, confirm:

```bash
sudo apt install build-essential libnode-dev libssl-dev libsecret-1-dev pkg-config
pkg-config --cflags libsecret-1
node --version
```

Node.js must be at least version 18. The compiler must find Node-API, OpenSSL, and libsecret headers.

## Authorization prompt does not appear

The official installer uses `pkexec` for the final replacement. Ensure a PolicyKit authentication agent is running in the graphical session.

You can prepare without applying:

```bash
npm run official:install -- --prepare-only
```

Review the printed manifest directory and helper command. Do not run a helper command copied from an untrusted source.

## Installer says Codex is running

Close all official and test windows. Electron may leave background processes briefly; wait a few seconds and retry.

To inspect relevant processes:

```bash
pgrep -af '/usr/lib/chatgpt/ChatGPT|codex-linux-remote-controller-test'
```

Do not force replacement while the app is reading its ASAR or addon.

## Test copy refuses to launch after an update

The launcher verifies that the official package still matches either:

- the source baseline recorded when the test copy was created; or
- a known applied official-patch record.

After a genuine package update, rebuild:

```bash
npm test
npm run inspect
npm run install -- --replace
npm run verify
```

## Official restore refuses

Restore refusal protects a newer or independently changed package. Run:

```bash
npm run official:verify
```

If current hashes do not match an applied record, reinstall the official package instead of forcing an old backup over it.

## Authorization completes but no Windows host appears

Check the host side:

- the Windows app is signed into the same ChatGPT account and workspace;
- **Control this PC** is enabled;
- the host is online and not suspended;
- required host permissions remain granted;
- the controller authorization completed in the same Linux profile now in use; and
- organizational policy permits Remote Connections.

This symptom is not usually solved by changing the Linux key provider.

## Logs

The isolated launcher writes:

```text
~/.local/share/codex-linux-remote-controller-test/versions/<version>/logs/launcher.log
```

Before sharing logs, remove access tokens, account identifiers, local paths, device names, repository names, and task content.

## Reporting a reproducible issue

Include:

- distribution and architecture;
- Codex package version;
- Node.js, OpenSSL, and libsecret versions;
- whether the test copy or official workflow was used;
- sanitized `inspect` and `verify` output;
- the exact failing command; and
- whether `npm test` passes.

Do not attach `app.asar`, native binaries from the Codex package, profile databases, cookies, keyring exports, or unsanitized logs.
