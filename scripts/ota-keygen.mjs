/**
 * Ключи подписи обновлений интерфейса (ed25519): закрытый — `update/keys/ota-private.pem` (не в git,
 * не терять и не публиковать: им подписываются обновления), открытый — `src-tauri/ota-public.key`
 * (вшивается в приложение). Существующий закрытый ключ не перезаписывается.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const PRIVATE = "update/keys/ota-private.pem";
const PUBLIC = "src-tauri/ota-public.key";

let privateKey;
if (existsSync(PRIVATE)) {
  privateKey = createPrivateKey(readFileSync(PRIVATE));
  console.log(`ключ уже есть: ${PRIVATE}`);
} else {
  ({ privateKey } = generateKeyPairSync("ed25519"));
  mkdirSync("update/keys", { recursive: true });
  writeFileSync(PRIVATE, privateKey.export({ format: "pem", type: "pkcs8" }));
  console.log(`новый ключ: ${PRIVATE}`);
}
const raw = Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url");
writeFileSync(PUBLIC, raw.toString("base64") + "\n");
console.log(`открытый ключ: ${PUBLIC}`);
