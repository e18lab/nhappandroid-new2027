/**
 * Обновления интерфейса по воздуху — обёртка над командами `src-tauri/src/ota.rs`.
 * Сервер обновлений — последний релиз GitHub (`npm run ota:pack` + `npm run ota:release`); в настройках
 * можно задать свой (например компьютер в той же сети: `npm run ota:serve`).
 * При запуске, если включено «Скачивать сами», приложение проверяет сервер и в фоне качает новую версию;
 * применяется она кнопкой в Настройки → Обновления (страница перезагружается) или при следующем запуске.
 *
 * Полное обновление (новая нативная часть — APK / установщик Windows) приложение тоже ставит само:
 * качает файл своей системы, на Android открывает системную установку, на Windows запускает
 * установщик без вопросов и закрывается — после установки приложение запускается снова.
 */
import { useSyncExternalStore } from "react";
import { inTauri } from "./downloads";
import { getItem, setItem } from "./storage";

export const OTA_URL_KEY = "ota.url";
export const OTA_AUTO_KEY = "ota.auto";
/** Последний релиз открытого репозитория. */
export const OTA_DEFAULT_URL = "https://github.com/e18lab/nhappandroid-new2027/releases/latest/download";

export interface OtaStatus {
  nativeVersion: string;
  nativeApi: number;
  uiVersion: string;
  pending: string | null;
}

export interface OtaCheck {
  /** Полное обновление приложения (новее установленного), если выложено для этой системы. */
  native: { version: string; size: number } | null;
  version: string;
  nativeApi: number;
  newer: boolean;
  compatible: boolean;
  files: number;
  bytes: number;
}

export type OtaPhase =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "native"
  | "downloading"
  | "ready"
  | "error"
  /** Есть полное обновление */
  | "full"
  | "fullDownloading"
  /** Android: нужно разрешить установку из приложения, потом нажать ещё раз */
  | "fullPermission";

export interface OtaState {
  phase: OtaPhase;
  status: OtaStatus | null;
  check: OtaCheck | null;
  progress: { done: number; total: number } | null;
  error: string | null;
}

let state: OtaState = { phase: "idle", status: null, check: null, progress: null, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<OtaState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useOta(): OtaState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export const otaAvailable = inTauri;

/** Адрес из настроек, иначе из сборки (`VITE_OTA_URL`, например в `.env.local`), иначе релизы GitHub. */
export function getOtaUrl(): string {
  return getItem(OTA_URL_KEY) || import.meta.env.VITE_OTA_URL || OTA_DEFAULT_URL;
}

export function setOtaUrl(url: string) {
  setItem(OTA_URL_KEY, url.trim());
}

export function getOtaAuto(): boolean {
  return getItem(OTA_AUTO_KEY) !== "0";
}

export function setOtaAuto(v: boolean) {
  setItem(OTA_AUTO_KEY, v ? "1" : "0");
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function refreshStatus(): Promise<OtaStatus | null> {
  if (!otaAvailable()) return null;
  const status = await call<OtaStatus>("ota_status");
  set({ status, phase: status.pending && state.phase === "idle" ? "ready" : state.phase });
  return status;
}

/** Проверить сервер. */
export async function checkUpdate(): Promise<OtaCheck | null> {
  const url = getOtaUrl();
  if (!otaAvailable() || !url) return null;
  set({ phase: "checking", error: null });
  try {
    const check = await call<OtaCheck>("ota_check", { url });
    const pending = state.status?.pending;
    set({
      check,
      phase: check.native
        ? "full"
        : !check.newer
          ? "latest"
          : !check.compatible
            ? "native"
            : pending === check.version
              ? "ready"
              : "available",
    });
    return check;
  } catch (e) {
    set({ phase: "error", error: String(e) });
    return null;
  }
}

/** Скачать новую версию (только недостающие файлы). */
export async function downloadUpdate(): Promise<boolean> {
  const url = getOtaUrl();
  if (!otaAvailable() || !url) return false;
  const { listen } = await import("@tauri-apps/api/event");
  const off = await listen<{ done: number; total: number }>("ota-progress", (e) => set({ progress: e.payload }));
  set({ phase: "downloading", progress: null, error: null });
  try {
    await call<string>("ota_download", { url });
    await refreshStatus();
    set({ phase: "ready" });
    return true;
  } catch (e) {
    set({ phase: "error", error: String(e) });
    return false;
  } finally {
    off();
  }
}

/** Применить скачанное и перезагрузить страницу. */
export async function applyUpdate() {
  await call("ota_apply");
  window.location.reload();
}

/** Вернуть вшитую версию интерфейса. */
export async function resetUpdate() {
  await call("ota_reset");
  window.location.reload();
}

let started = false;
let lastCheck = 0;
/** Повторная проверка при возврате в приложение — не чаще раза в 5 минут. */
const RECHECK_MS = 5 * 60 * 1000;

async function autoCheck() {
  if (state.phase === "checking" || state.phase === "downloading" || state.phase === "ready") return;
  if (!getOtaAuto() || !getOtaUrl()) return;
  lastCheck = Date.now();
  try {
    const check = await checkUpdate();
    if (check && state.phase === "available") await downloadUpdate();
  } catch {
    /* сервер недоступен — не мешаем работе */
  }
}

/** При запуске: статус и, если включено, проверка с фоновой загрузкой; ещё раз — при возврате в приложение. */
export function startAutoUpdate() {
  if (started || !otaAvailable()) return;
  started = true;
  void refreshStatus().then(autoCheck, () => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > RECHECK_MS) void autoCheck();
  });
}

/** Полное обновление: скачать APK / установщик и поставить. */
export async function installFullUpdate() {
  const url = getOtaUrl();
  if (!otaAvailable() || !url) return;
  const { listen } = await import("@tauri-apps/api/event");
  const off = await listen<{ done: number; total: number }>("ota-native-progress", (e) => set({ progress: e.payload }));
  set({ phase: "fullDownloading", progress: null, error: null });
  try {
    const path = await call<string>("ota_native_download", { url });
    if (window.NHAppNative?.installApk) {
      const res = window.NHAppNative.installApk(path);
      if (res === "permission") set({ phase: "fullPermission" });
      else if (res !== "ok") set({ phase: "error", error: res });
      else set({ phase: "full" });
    } else {
      // Windows: установщик ставит и запускает приложение заново, это окно закрывается
      await call("ota_native_run");
    }
  } catch (e) {
    set({ phase: "error", error: String(e) });
  } finally {
    off();
  }
}

/** Кнопка в шапке: полное обновление, или скачать (если ещё нет) и применить интерфейс. */
export async function installUpdate() {
  if (state.phase === "full" || state.phase === "fullPermission") return installFullUpdate();
  if (state.phase === "available" && !(await downloadUpdate())) return;
  if (state.phase === "ready") await applyUpdate();
}
