// Пути проекта и окружение для инструментов Android (общее для сборки и дев-режима).
// Берёт переменные окружения, если они заданы, иначе ищет стандартные места на Windows.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const tauriDir = join(root, "src-tauri");
export const androidDir = join(tauriDir, "gen", "android");
export const libName = "libnhappandroid_new2027_lib.so";

// --target из tauri → triple Rust, ABI Android, имя flavor в Gradle
export const TARGETS = {
  aarch64: { triple: "aarch64-linux-android", abi: "arm64-v8a", flavor: "Arm64" },
  armv7: { triple: "armv7-linux-androideabi", abi: "armeabi-v7a", flavor: "Arm" },
  i686: { triple: "i686-linux-android", abi: "x86", flavor: "X86" },
  x86_64: { triple: "x86_64-linux-android", abi: "x86_64", flavor: "X86_64" },
};

function newestDir(parent) {
  if (!existsSync(parent)) return null;
  const dirs = readdirSync(parent).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return dirs.length ? join(parent, dirs[dirs.length - 1]) : null;
}

/** Окружение с ANDROID_HOME, NDK_HOME, JAVA_HOME и PATH; чего-то нет — сообщение и выход. */
export function androidEnv() {
  const env = { ...process.env };
  const local = env.LOCALAPPDATA ?? "";

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
  return env;
}
