// Живая разработка: `npm run win-dev` — окно на ПК, `npm run android-dev` — телефон по USB.
// Правки интерфейса применяются сразу (HMR), правки Rust — на ПК сами, на телефоне см. ниже.
//
// Vite один на всех: уже запущенный (например, вторым скриптом) используется повторно, поэтому ПК и телефон
// можно держать открытыми одновременно, и вход в аккаунт у них общий (`/__dev/auth`, vite.config.ts).
// Телефон ходит на 127.0.0.1:1420 компьютера через `adb reverse` — нужен только USB, сеть и брандмауэр ни при чём.
//
// Без «режима разработчика» Windows не даёт Tauri создать символическую ссылку на .so, и `tauri android dev`
// падает в конце сборки. Тогда скрипт сам кладёт .so в jniLibs, ставит приложение через Gradle и показывает логи.
// В этом случае после правок Rust команду надо запустить заново.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TARGETS, androidDir, androidEnv, libName, root, tauriDir } from "./android-env.mjs";

const DEV_ORIGIN = "http://127.0.0.1:1420";
const PACKAGE = "com.nhapp.android";

const mode = process.argv[2];
if (mode !== "win" && mode !== "android") {
  console.error("Использование: node scripts/dev.mjs win|android");
  process.exit(1);
}
const env = mode === "android" ? androidEnv() : { ...process.env };

let vite = null;
let stopping = false;

function stopVite() {
  if (!vite?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(vite.pid), "/T", "/F"], { stdio: "ignore" });
  else vite.kill();
  vite = null;
}

function exit(code) {
  stopVite();
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    exit(0);
  });
}

function runAsync(cmd, args, cwd = root) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env, shell: true, cwd });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function adb(...args) {
  const r = spawnSync("adb", args, { env, shell: true, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

async function viteIsUp() {
  try {
    return (await fetch(`${DEV_ORIGIN}/@vite/client`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function ensureVite() {
  if (await viteIsUp()) {
    console.log(`Vite уже запущен: ${DEV_ORIGIN}`);
    return;
  }
  // TAURI_DEV_HOST не передаём: Vite всегда слушает 127.0.0.1, телефону порт пробрасывает adb
  const { TAURI_DEV_HOST: _unused, ...viteEnv } = env;
  vite = spawn("npx", ["vite"], { stdio: "inherit", env: viteEnv, shell: true, cwd: root });
  let exited = false;
  vite.on("exit", () => (exited = true));
  for (let i = 0; i < 120 && !exited; i++) {
    if (await viteIsUp()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(exited ? "Vite не запустился: порт 1420 занят другой программой?" : "Vite не ответил за 30 секунд");
  exit(1);
}

/**
 * Настройки только для дева: Vite запускает сам скрипт, а в CSP добавляется адрес дев-сервера
 * (на Android страница идёт через прокси Tauri, и HMR для неё — другой адрес). В боевой CSP этого нет.
 */
function writeDevConfig() {
  const conf = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
  const devCsp = conf.app.security.csp.replace("connect-src", `connect-src ${DEV_ORIGIN} ws://127.0.0.1:1420`);
  const path = join(tauriDir, "target", "dev.conf.json");
  mkdirSync(join(tauriDir, "target"), { recursive: true });
  writeFileSync(path, JSON.stringify({ build: { beforeDevCommand: null }, app: { security: { devCsp } } }));
  return path;
}

async function installWithGradle(startedAt) {
  const abi = adb("shell", "getprop", "ro.product.cpu.abi").out;
  const target = Object.values(TARGETS).find((t) => t.abi === abi);
  const so = target && join(tauriDir, "target", target.triple, "debug", libName);
  // Библиотека не пересобрана — значит, упала сама сборка Rust, и Gradle тут не поможет
  if (!so || !existsSync(so) || statSync(so).mtimeMs < startedAt) return false;

  console.log("\nСимволическая ссылка недоступна — ставлю приложение через Gradle с готовой .so\n");
  const dest = join(androidDir, "app", "src", "main", "jniLibs", target.abi);
  mkdirSync(dest, { recursive: true });
  copyFileSync(so, join(dest, libName));

  const localProps = join(androidDir, "local.properties");
  if (!existsSync(localProps)) writeFileSync(localProps, `sdk.dir=${env.ANDROID_HOME.replaceAll("\\", "/")}\n`);

  const skip = Object.values(TARGETS).flatMap((t) => ["-x", `rustBuild${t.flavor}Debug`]);
  const gradlew = `"${join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew")}"`;
  const code = await runAsync(gradlew, [`install${target.flavor}Debug`, "-x", "rustBuildUniversalDebug", ...skip], androidDir);
  if (code !== 0) {
    console.error("\nGradle не установил приложение. Если это INSTALL_FAILED_UPDATE_INCOMPATIBLE, на телефоне приложение с другой подписью:");
    console.error("удаление сотрёт его данные, поэтому скрипт сам этого не делает.");
    exit(code);
  }
  adb("reverse", "tcp:1420", "tcp:1420");
  adb("shell", "am", "start", "-S", "-n", `${PACKAGE}/.MainActivity`);
  console.log("\nПриложение запущено, правки интерфейса применяются сразу. Логи ниже, Ctrl+C — выход.\n");
  await runAsync("adb", ["logcat", "-T", "1", "RustStdoutStderr:V", "Tauri/Console:V", "*:S"]);
  return true;
}

async function androidDev(config) {
  const devices = adb("devices").out.split("\n").slice(1).filter((l) => /\sdevice$/.test(l.trim()));
  if (devices.length === 0) {
    console.error("Нет устройства: подключите телефон по USB и разрешите отладку.");
    exit(1);
  }
  if (devices.length > 1) {
    console.error("Подключено несколько устройств, оставьте одно:\n" + devices.join("\n"));
    exit(1);
  }
  const reverse = adb("reverse", "tcp:1420", "tcp:1420");
  if (!reverse.ok) {
    console.error(`Не удалось пробросить порт: ${reverse.err}`);
    exit(1);
  }
  const startedAt = Date.now();
  const code = await runAsync("npx", ["tauri", "android", "dev", "--host", "127.0.0.1", "--config", `"${config}"`]);
  if (stopping) return 0;
  if (code !== 0 && (await installWithGradle(startedAt))) return 0;
  return code;
}

await ensureVite();
const config = writeDevConfig();
const code = mode === "win" ? await runAsync("npx", ["tauri", "dev", "--config", `"${config}"`]) : await androidDev(config);
exit(code);
