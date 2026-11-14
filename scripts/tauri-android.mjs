// Запускает `tauri android <args>` с путями к Android SDK, NDK и JDK (см. android-env.mjs).
//
// Без «режима разработчика» Windows не даёт Tauri создать символическую ссылку на собранную
// .so в jniLibs, и `build` падает в самом конце. Тогда скрипт копирует .so сам и доводит
// сборку через Gradle, пропуская Rust-задачи (библиотека уже собрана).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TARGETS, androidDir, androidEnv, libName, root, tauriDir } from "./android-env.mjs";

const env = androidEnv();

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
