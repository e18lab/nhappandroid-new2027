/**
 * Аккаунт nhentai в приложении — перенос `hooks/useOnlineMe.ts` и `hooks/useAuthBridge.ts`.
 * Профиль (`GET /user`) загружается при старте, если есть токены, и после входа; выход отзывает сессию.
 *
 * Облако — облако MoeLibre (`cloudSync.ts`), по аккаунту MoeLibre ID; сюда сообщается только, какой аккаунт
 * nhentai сейчас на устройстве: его библиотека (закладки, история) — своя часть облака и своё отложенное
 * на устройстве. Старое облако nappi больше не используется.
 */
import { useSyncExternalStore } from "react";
import { useBoundValue } from "../browser/tabs";
import { getMe } from "../api/account";
import { logout } from "../api/auth";
import { ApiError, clearTokens, devPullTokens, hasSession, storeTokens } from "../api/client";
import type { Me } from "../api/types";
import { clearLibraryAfterLogout, setCloudNhAccount } from "./cloudSync";
import { unlinkBeforeNhLogout } from "./mlNhentai";
import { forgetSession, rememberCurrentSession, repairSavedSession } from "./nhAccounts";
import { syncOnlineFavorites } from "./onlineFavorites";
import { resetRecommendations } from "./recommendations";


let me: Me | null = null;
let started = false;
/**
 * Номер последнего запроса профиля / смены аккаунта. Ответ на запрос профиля, отправленный до смены аккаунта
 * (например, стартовый — с токенами прошлого запуска), устарел: без этой проверки он возвращал прежний аккаунт
 * поверх выбранного во вкладке, и вкладка запоминала его.
 */
let generation = 0;
const listeners = new Set<() => void>();

function set(next: Me | null) {
  me = next;
  // Библиотека прежнего аккаунта откладывается, нового — возвращается; облако слушает часть этого аккаунта
  setCloudNhAccount(next?.id ?? null);
  // Сессия и профиль аккаунта — на устройстве, для мгновенного переключения вкладок
  if (next) rememberCurrentSession(next);
  for (const fn of listeners) fn();
}

/**
 * Профиль с сервера; при 401 (токены отозваны) — сессия сбрасывается клиентом.
 * `expectId` — аккаунт, на который только что переключились по сохранённой сессии: если токены оказались
 * от другого аккаунта (сохранённое испорчено), сессия берётся заново из привязки MoeLibre.
 */
export async function refreshMe(expectId?: number): Promise<Me | null> {
  const gen = ++generation;
  if (!hasSession()) {
    set(null);
    return null;
  }
  try {
    const next = await getMe();
    if (gen !== generation) return me;
    if (expectId != null && next.id !== expectId) {
      const fresh = await repairSavedSession(expectId);
      if (gen !== generation) return me;
      if (fresh) {
        storeTokens(fresh.access, fresh.refresh);
        return refreshMe();
      }
    }
    set(next);
    void syncOnlineFavorites();
  } catch (e) {
    if (gen !== generation) return me;
    // Сеть могла упасть только сейчас — профиль не затираем, пока токены на месте
    if (!hasSession() || (e instanceof ApiError && e.status === 401)) set(null);
  }
  return me;
}

export function useMe(): Me | null {
  // В невыбранной вкладке аккаунт не меняется — её экраны не перезагружаются от аккаунта другой вкладки
  return useBoundValue(useMeLive());
}

function useMeLive(): Me | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!started) {
        started = true;
        // В разработке сперва забираем вход у соседа (`tauri dev` ↔ браузер), в сборке — сразу профиль
        void devPullTokens().finally(() => void refreshMe());
      }
      return () => listeners.delete(cb);
    },
    () => me,
  );
}

/** Подписка на смену аккаунта вне React (вкладки запоминают свой аккаунт). */
export function subscribeMe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** id вошедшего аккаунта nhentai (профиль уже загружен), иначе null. */
export const currentNhUserId = (): number | null => me?.id ?? null;

/**
 * Сменить аккаунт nhentai на устройстве без выхода на сервере — сессии остаются в привязке MoeLibre.
 * Библиотека прежнего аккаунта откладывается на устройстве (и лежит в его части облака), нового — возвращается.
 * `next` — токены нового аккаунта; null — остаться без входа (дальше — окно входа).
 */
export async function swapNhAccount(next: { access: string; refresh: string } | null, cachedMe?: Me): Promise<void> {
  generation++;
  if (me) resetRecommendations();
  if (next && cachedMe) {
    // Сразу на другой аккаунт, без промежуточного «без входа»: экраны не дёргаются лишний раз
    storeTokens(next.access, next.refresh);
    set(cachedMe);
    void refreshMe(cachedMe.id);
    return;
  }
  set(null);
  if (next) {
    storeTokens(next.access, next.refresh);
    await refreshMe();
  } else clearTokens();
}

export async function signOut(): Promise<void> {
  generation++;
  if (me) forgetSession(me.id);
  clearLibraryAfterLogout();
  resetRecommendations();
  // Сессия общая с другими устройствами через MoeLibre — сначала отвязать, потом отозвать
  await unlinkBeforeNhLogout();
  await logout();
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
