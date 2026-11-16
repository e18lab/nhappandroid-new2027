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
import { ApiError, hasUserSession, clearTokens, devPullTokens, hasSession, loadAccessToken, loadAccountKey, storeAccountKey, storeTokens, type NhAuth } from "../api/client";
import type { Me } from "../api/types";
import { clearLibraryAfterLogout, setCloudNhAccount } from "./cloudSync";
import { pushNhSessionSoon, unlinkBeforeNhLogout } from "./mlNhentai";
import { forgetSession, rememberCurrentSession, rememberSessionOf, repairSavedSession } from "./nhAccounts";
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
/** Аккаунт, на который сейчас переключают клиент (профиль ещё не подтверждён). */
let target: number | null = null;

/** Чей вход сейчас в клиенте: подтверждённый профиль, а пока он грузится — аккаунт, на который переключают. */
export const clientAccountId = (): number | null => me?.id ?? target;
const listeners = new Set<() => void>();

/** Разработка: откуда вызвали (для логов моста отладки). */
function devStack(): string {
  return (new Error().stack ?? "")
    .split("\n")
    .slice(3, 7)
    .map((l) => l.trim().replace(/^at /, "").replace(/https?:\/\/[^/]+\/src\//, "").replace(/\?t=\d+/, ""))
    .join(" ← ");
}

function set(next: Me | null) {
  if (import.meta.env.DEV && (next?.id ?? null) !== (me?.id ?? null))
    console.debug(`[me] ${me?.id ?? "—"} → ${next?.id ?? "—"} | ${devStack()}`);
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
export async function refreshMe(expectId?: number, repaired = false): Promise<Me | null> {
  const gen = ++generation;
  if (!hasSession()) {
    set(null);
    return null;
  }
  try {
    const next = await getMe();
    if (gen !== generation) return me;
    if (expectId != null && next.id !== expectId) {
      // Токены — от другого аккаунта. Они настоящие — сохраним под тем, чей это аккаунт
      rememberSessionOf(next);
      const fresh = repaired ? null : await repairSavedSession(expectId);
      if (gen !== generation) return me;
      if (fresh && ((fresh.access ?? null) !== loadAccessToken() || (fresh.apiKey ?? null) !== loadAccountKey())) {
        putAuth(fresh);
        return refreshMe(expectId, true);
      }
      // Настоящей сессии этого аккаунта нет нигде (в привязке тоже чужая) — без входа, но не под чужим
      // аккаунтом: вкладка помнит свой аккаунт, а клиент не выдаёт другой за него
      clearTokens();
      storeAccountKey(null);
      set(null);
      return null;
    }
    set(next);
    // Профиль подтверждён — сессия этого аккаунта уходит в привязку MoeLibre (чинит испорченную там)
    pushNhSessionSoon();
    void syncOnlineFavorites();
  } catch (e) {
    if (gen !== generation) return me;
    // Сеть могла упасть только сейчас — профиль не затираем, пока токены на месте. 401 при живых токенах —
    // обновление отложено (nhentai ответил 429), это не выход; 401 только по ключу — ключ не принимают
    if (!hasSession() || (e instanceof ApiError && e.status === 401 && !hasUserSession())) set(null);
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

/**
 * Аккаунт сменили намеренно: вошли в окне входа или вышли. Только так меняется аккаунт выбранной вкладки
 * (`tabBinding.ts`); сбой сессии, обновление токенов или ответ профиля аккаунт вкладки не трогают.
 */
export const accountIntent: { onExplicit?: (id: number | null) => void } = {};

/** Вошли в окне входа — аккаунт становится аккаунтом выбранной вкладки. */
export function confirmSignedInHere(): void {
  accountIntent.onExplicit?.(me?.id ?? null);
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
export async function swapNhAccount(next: NhAuth | null, cachedMe?: Me, expectId?: number): Promise<void> {
  generation++;
  target = next ? (expectId ?? cachedMe?.id ?? null) : null;
  if (import.meta.env.DEV) console.debug(`[swap] → ${next ? (target ?? "?") : "без входа"}${next?.access ? " сессия" : ""}${next?.apiKey ? " ключ" : ""} | ${devStack()}`);
  if (me) resetRecommendations();
  const usable = !!next && (!!(next.access && next.refresh) || !!next.apiKey);
  if (usable && cachedMe) {
    // Сразу на другой аккаунт, без промежуточного «без входа»: экраны не дёргаются лишний раз
    putAuth(next!);
    set(cachedMe);
    void refreshMe(cachedMe.id);
    return;
  }
  set(null);
  if (usable) {
    putAuth(next!);
    await refreshMe(expectId);
  } else {
    clearTokens();
    storeAccountKey(null);
  }
}

let swapping = false;
/** Идёт подмена входа: сохранённые токены ещё не того аккаунта, что `me` (не запоминать их под ним). */
export const isSwappingAuth = () => swapping;

/** Вход аккаунта — в клиент: сессия (или её нет) и ключ. */
function putAuth(next: NhAuth) {
  swapping = true;
  try {
    storeAccountKey(next.apiKey ?? null);
    if (next.access && next.refresh) storeTokens(next.access, next.refresh);
    else clearTokens();
  } finally {
    swapping = false;
  }
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
  accountIntent.onExplicit?.(null);
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
