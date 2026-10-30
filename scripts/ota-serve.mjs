/**
 * Раздача обновлений с этого компьютера для проверки (телефон в той же сети): `update/ota` на порту 8787.
 * Адрес из вывода вписать в приложении: Настройки → Обновления → Сервер обновлений.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join, normalize } from "node:path";

const ROOT = "update/ota";
const PORT = Number(process.env.PORT) || 8787;

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([/\])+/, "");
  const file = join(ROOT, path);
  if (path.includes("..") || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    console.log("404", req.url);
    return;
  }
  res.writeHead(200, { "Content-Length": statSync(file).size, "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
  console.log("200", req.url);
}).listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal);
  console.log(`Сервер обновлений: ${ROOT}`);
  for (const i of ips) console.log(`  http://${i.address}:${PORT}`);
  console.log(`  http://localhost:${PORT} (ПК)`);
});
