/**
 * Аккаунт nhentai в приложении — перенос `hooks/useOnlineMe.ts` и `hooks/useAuthBridge.ts`.
 * Профиль (`GET /user`) загружается при старте, если есть токены, и после входа; выход отзывает сессию.
 *
 * После входа устройство регистрируется на сервере nappi (`/api/users/sync`) и подключается к лобби
 * облачной синхронизации (`cloudSync.ts`). При выходе, как `clearUserLocalDataOnLogout` в старом,
 * локальная библиотека стирается — но только если в этой сессии она успела уйти в облако.
 */
import { useSyncExternalStore } from "react";
import { getMe } from "../api/account";
import { logout } from "../api/auth";
import { ApiError, hasSession } from "../api/client";
import type { Me } from "../api/types";
import { syncUser, touchOnline } from "../api/nappi";
import { clearLibraryAfterLogout, startCloudSync, stopCloudSync } from "./cloudSync";
import { getDeviceId, getDeviceName } from "./device";
import { syncOnlineFavorites } from "./onlineFavorites";
import { removeItem } from "./storage";

const ONLINE_KEYS = ["bookFavoritesOnline.v1", "@online.imported.cache", "@online.pendingFavorites.queue", "profile.me", "nh.me"];

let me: Me | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(next: Me | null) {
  const prevId = me?.id;
  me = next;
  if (next?.id && next.id !== prevId) connectCloud(next);
  else if (!next && prevId) stopCloudSync(true);
  for (const fn of listeners) fn();
}

/** Профиль с сервера; при 401 (токены отозваны) — сессия сбрасывается клиентом. */
export async function refreshMe(): Promise<Me | null> {
  if (!hasSession()) {
    set(null);
    return null;
  }
  try {
    set(await getMe());
    void syncOnlineFavorites();
  } catch (e) {
    // Сеть могла упасть только сейчас — профиль не затираем, пока токены на месте
    if (!hasSession() || (e instanceof ApiError && e.status === 401)) set(null);
  }
  return me;
}

export function useMe(): Me | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!started) {
        started = true;
        void refreshMe();
      }
      return () => listeners.delete(cb);
    },
    () => me,
  );
}

/** Регистрация устройства (useOnlineMe в старом) и лобби; ошибки сети не мешают работе. */
function connectCloud(user: Me) {
  const deviceId = getDeviceId();
  const deviceName = getDeviceName();
  void syncUser({ id: user.id, username: user.username, deviceId, deviceName }).catch(() => undefined);
  const online = () => void touchOnline(user.id, deviceId).catch(() => undefined);
  online();
  startCloudSync(user.id, deviceId, deviceName, online);
}

export async function signOut(): Promise<void> {
  clearLibraryAfterLogout();
  await logout();
  for (const key of ONLINE_KEYS) removeItem(key);
  set(null);
}

// ─── Капча (Android: CaptchaDialog.kt, ПК: src-tauri/src/captcha.rs) ──────────

declare global {
  interface Window {
    NHAppCaptcha?: {
      open(siteKey: string, provider: string, title: string, errorText: string, retryText: string, cancelText: string): void;
    };
    __nhCaptchaToken?: (token: string) => void;
  }
}

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Капча открывается только в приложении: ключ привязан к nhentai.net, в браузере при разработке её не пройти. */
export const captchaSupported = () => !!window.NHAppCaptcha || inTauri();

export interface CaptchaLabels {
  title: string;
  error: string;
  retry: string;
  cancel: string;
}

/** Открывает окно капчи; токен или "" (закрыли / ошибка). */
export async function requestCaptcha(siteKey: string, provider: string, labels: CaptchaLabels): Promise<string> {
  if (window.NHAppCaptcha) {
    const native = window.NHAppCaptcha;
    return new Promise((resolve) => {
      window.__nhCaptchaToken = (token) => {
        window.__nhCaptchaToken = undefined;
        resolve(token || "");
      };
      native.open(siteKey, provider, labels.title, labels.error, labels.retry, labels.cancel);
    });
  }
  if (!inTauri()) return "";
  const [{ invoke }, { once }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
  return new Promise((resolve) => {
    void once<string>("nh-captcha", (e) => resolve(e.payload || "")).then(() =>
      invoke("open_captcha", {
        siteKey,
        provider,
        title: labels.title,
        errorText: labels.error,
        retryText: labels.retry,
      }).catch(() => resolve("")),
    );
  });
}

/** Адрес своего профиля (вкладка «Профиль» нижней панели); без входа — пусто. */
export function ownProfileRoute(user: Me | null): string {
  return user ? `/profile/${user.id}/${encodeURIComponent((user.slug || user.username || String(user.id)).toLowerCase())}` : "";
}
