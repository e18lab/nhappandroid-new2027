// Запускает `tauri android <args>` с путями к Android SDK, NDK и JDK.
// Берёт переменные окружения, если они заданы, иначе ищет стандартные места на Windows.
//
// Без «режима разработчика» Windows не даёт Tauri создать символическую ссылку на собранную
// .so в jniLibs, и `build` падает в самом конце. Тогда скрипт копирует .so сам и доводит
// сборку через Gradle, пропуская Rust-задачи (библиотека уже собрана).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const androidDir = join(tauriDir, "gen", "android");
const libName = "libnhappandroid_new2027_lib.so";

// --target из tauri → triple Rust, ABI Android, имя flavor в Gradle
const TARGETS = {
  aarch64: { triple: "aarch64-linux-android", abi: "arm64-v8a", flavor: "Arm64" },
  armv7: { triple: "armv7-linux-androideabi", abi: "armeabi-v7a", flavor: "Arm" },
  i686: { triple: "i686-linux-android", abi: "x86", flavor: "X86" },
  x86_64: { triple: "x86_64-linux-android", abi: "x86_64", flavor: "X86_64" },
};

const env = { ...process.env };
const local = env.LOCALAPPDATA ?? "";

function newestDir(parent) {
  if (!existsSync(parent)) return null;
  const dirs = readdirSync(parent).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  return dirs.length ? join(parent, dirs[dirs.length - 1]) : null;
}

env.ANDROID_HOME ??= env.ANDROID_SDK_ROOT ?? join(local, "Android", "Sdk");
env.NDK_HOME ??= newestDir(join(env.ANDROID_HOME, "ndk")) ?? "";

if (!env.JAVA_HOME || !existsSync(join(env.JAVA_HOME, "bin"))) {
  const studioJbr = "C:\\Program Files\\Android\\Android Studio\\jbr";
  env.JAVA_HOME = existsSync(studioJbr) ? studioJbr : env.JAVA_HOME;
}

for (const [name, path] of [
  ["ANDROID_HOME", env.ANDROID_HOME],
  ["NDK_HOME", env.NDK_HOME],
  ["JAVA_HOME", env.JAVA_HOME],
]) {
  if (!path || !existsSync(path)) {
    console.error(`Не найден ${name}: ${path || "(пусто)"}`);
    process.exit(1);
  }
}

const sep = process.platform === "win32" ? ";" : ":";
env.PATH = [join(env.JAVA_HOME, "bin"), join(env.ANDROID_HOME, "platform-tools"), env.PATH].join(sep);

function run(cmd, args, cwd = root) {
  return spawnSync(cmd, args, { stdio: "inherit", env, shell: true, cwd }).status ?? 1;
}

const args = process.argv.slice(2);
let status = run("npx", ["tauri", "android", ...args]);

if (status !== 0 && args[0] === "build" && existsSync(androidDir)) {
  status = finishWithGradle(args);
}
process.exit(status);

function finishWithGradle(buildArgs) {
  const debug = buildArgs.includes("--debug");
  const profile = debug ? "debug" : "release";
  const mode = debug ? "Debug" : "Release";

  const requested = [];
  buildArgs.forEach((a, i) => {
    if (a === "--target" || a === "-t") requested.push(buildArgs[i + 1]);
  });
  const names = requested.length ? requested : Object.keys(TARGETS);

  for (const name of names) {
    const t = TARGETS[name];
    const so = t && join(tauriDir, "target", t.triple, profile, libName);
    if (!so || !existsSync(so)) {
      console.error(`Нет собранной библиотеки для ${name}: ${so ?? "неизвестная цель"}`);
      return 1;
    }
    const dest = join(androidDir, "app", "src", "main", "jniLibs", t.abi);
    mkdirSync(dest, { recursive: true });
    copyFileSync(so, join(dest, libName));
  }

  const localProps = join(androidDir, "local.properties");
  if (!existsSync(localProps)) {
    writeFileSync(localProps, `sdk.dir=${env.ANDROID_HOME.replaceAll("\\", "/")}\n`);
  }

  const single = names.length === 1 ? TARGETS[names[0]].flavor : null;
  const skip = Object.values(TARGETS).flatMap((t) => ["-x", `rustBuild${t.flavor}${mode}`]);
  skip.push("-x", `rustBuildUniversal${mode}`);

  console.log("\nСимволическая ссылка недоступна — собираю APK через Gradle с готовой .so\n");
  const gradlew = `"${join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew")}"`;
  const code = run(gradlew, [`assemble${single ?? "Universal"}${mode}`, ...skip], androidDir);
  if (code === 0) {
    console.log(`\nAPK: ${join(androidDir, "app", "build", "outputs", "apk")}`);
  }
  return code;
}
