# Installation guide

## Before starting

This is an unofficial experiment. Read [Security](../SECURITY.md), ensure you can reinstall the official Codex package, and do not test against irreplaceable work.

The recommended sequence is:

1. inspect the installed package;
2. run all tests;
3. build an isolated copy;
4. prove enrollment and host control;
5. only then consider patching the official installation.

## Supported and tested environment

The tooling expects:

- Linux x86-64 or arm64;
- Codex installed at `/usr/lib/chatgpt`;
- Node.js 18 or newer;
- OpenSSL 3;
- a desktop D-Bus session;
- a Secret Service provider, tested with GNOME Keyring; and
- C/C++ build tools and development headers.

Install Ubuntu or Debian build dependencies:

```bash
sudo apt update
sudo apt install build-essential libnode-dev libssl-dev libsecret-1-dev pkg-config
```

The code has no npm runtime dependencies.

## 1. Inspect the package

From the project directory:

```bash
npm run inspect
```

The report should identify one renderer target and the expected device-key client markers. A missing replacement provider warning is normal before the first native build.

Stop if inspection reports duplicate, missing, or changed markers. Do not weaken the checks merely to make a new version patch.

## 2. Run the test suite

```bash
npm test
```

This performs:

- JavaScript ASAR patch and contract tests;
- a native build;
- a disposable D-Bus and GNOME Keyring test;
- create/read/sign/verify/delete lifecycle checks; and
- metadata permission checks.

## 3. Install the isolated test copy

```bash
npm run install
npm run verify
```

The installer:

1. reads and hashes the official package;
2. copies the complete application into user-owned storage;
3. checks that the official source did not change during copying;
4. patches only the copied ASAR;
5. replaces only the copied native addon;
6. records hashes and package version in a manifest; and
7. leaves `/usr/lib/chatgpt` untouched.

The test state root is:

```text
~/.local/share/codex-linux-remote-controller-test/
```

Rebuild an existing copy for the same version:

```bash
npm run install -- --replace
```

## 4. Launch with an isolated profile

Close all official and test Codex windows, then run:

```bash
npm run launch
```

The launcher refuses to run concurrently with another official or test process. It verifies staged hashes before launch and opens:

```text
Settings → Connections → Control other devices
```

Sign in normally. Do not copy cookies, databases, or the official Chromium profile into the test profile.

The optional existing-profile mode is intended only after the isolated path succeeds:

```bash
npm run launch -- --use-existing-profile
```

Never run the official app and test copy concurrently against the same profile.

## 5. Configure the Windows host

On the Windows computer:

1. use the official Codex app;
2. sign in with the same ChatGPT account and workspace;
3. open **Settings → Connections → Control this PC**;
4. complete the official host setup; and
5. leave the host enabled and online.

The Windows app does not need this Linux patch when its official host feature is available.

## 6. Validate end to end

From the Linux test copy:

1. authorize the controller through the normal ChatGPT flow;
2. add or select the Windows host;
3. confirm it reports connected;
4. run a read-only task;
5. test one write in a disposable repository and confirm approval behavior;
6. restart both apps; and
7. confirm reconnection.

Do not treat UI visibility alone as success.

## 7. Patch the official installation

Only after the isolated test succeeds, close every Codex process and run:

```bash
npm run official:install
npm run official:verify
```

`official:install`:

- builds the provider;
- verifies the current app contract;
- creates owner-only, versioned backups;
- prepares patched candidates without privileges;
- rechecks source hashes;
- requests administrator authorization through `pkexec`;
- atomically replaces only the ASAR and device-key addon;
- rolls back if the second replacement fails; and
- removes successful staged candidates while retaining originals and records.

The privileged command runs JavaScript from this checkout. Inspect the source and ensure no other process can modify the checkout before approving `pkexec`. Treat the authorization as granting the reviewed project code root access; the helper is purpose-limited but cannot protect against malicious code in its own user-owned source tree.

To prepare without applying:

```bash
npm run official:install -- --prepare-only
```

The command prints the exact privileged helper invocation for the prepared manifest.

## Restore

Close Codex and run:

```bash
npm run official:restore
```

Restore proceeds only if the installed files match the patched hashes recorded in the corresponding manifest. This prevents an old backup from overwriting a newer package.

If verification or rollback is unavailable, reinstall the official Codex package from its original package source.

## Remove the test copy

Retain its isolated profile:

```bash
npm run remove
```

Remove the test copy and isolated profile:

```bash
npm run remove -- --profile
```
