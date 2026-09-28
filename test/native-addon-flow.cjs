const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const addon = require(process.env.ADDON_PATH);

async function main() {
  assert.deepEqual(Object.keys(addon).sort(), [
    "createDeviceKey",
    "deleteDeviceKey",
    "getDeviceKeyPublic",
    "signDeviceKey",
  ]);

  await assert.rejects(addon.createDeviceKey("hardware_only"), /usable TPM 2\.0/);

  const created = await addon.createDeviceKey("allow_os_protected_nonextractable");
  assert.match(created.keyId, /^dk_osn_linux_v1_[0-9a-f]{32}$/);
  assert.equal(created.algorithm, "ecdsa_p256_sha256");
  assert.equal(created.protectionClass, "os_protected_nonextractable");

  const publicResult = await addon.getDeviceKeyPublic(created.keyId);
  assert.deepEqual(publicResult, created);

  const payload = Buffer.from("codex-linux-provider-test", "utf8");
  const signed = await addon.signDeviceKey(created.keyId, payload);
  assert.equal(signed.algorithm, "ecdsa_p256_sha256");
  assert.equal(
    crypto.verify(
      "sha256",
      payload,
      {
        key: Buffer.from(created.publicKeySpkiDerBase64, "base64"),
        format: "der",
        type: "spki",
      },
      Buffer.from(signed.signatureDerBase64, "base64"),
    ),
    true,
  );

  const emptySignature = await addon.signDeviceKey(created.keyId, Buffer.alloc(0));
  assert.equal(
    crypto.verify(
      "sha256",
      Buffer.alloc(0),
      {
        key: Buffer.from(created.publicKeySpkiDerBase64, "base64"),
        format: "der",
        type: "spki",
      },
      Buffer.from(emptySignature.signatureDerBase64, "base64"),
    ),
    true,
  );

  const store = path.join(process.env.CODEX_HOME, "device-keys-os-protected-v1");
  const recordPath = path.join(store, `${created.keyId}.record`);
  assert.equal(fs.statSync(store).mode & 0o777, 0o700);
  assert.equal(fs.statSync(recordPath).mode & 0o777, 0o600);
  const record = fs.readFileSync(recordPath, "utf8");
  assert.match(record, /public_key_spki_der_base64=/);
  assert.doesNotMatch(record, /private/i);

  await addon.deleteDeviceKey(created.keyId);
  await assert.rejects(addon.getDeviceKeyPublic(created.keyId), /device key not found/);
  await addon.deleteDeviceKey(created.keyId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
