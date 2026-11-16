/**
 * Ключ API аккаунта nhentai — «вход навсегда». Сессия nhentai протухает (токены обновляются, обновление может
 * сорваться), а ключ живёт, пока его не отзовут на сайте (Settings → API Keys). С ключом аккаунт работает на
 * любом устройстве с этим MoeLibre ID: каталог, книги, онлайн-избранное, чёрный список, профиль. Писать
 * комментарии и менять профиль ключ не даёт — для этого нужна живая сессия (приложение просит войти).
 *
 * Ключ создаётся после входа (нужна сессия; nhentai требует капчу и proof of work), хранится на устройстве
 * у аккаунта (`nhAccounts.ts`) и в привязке MoeLibre — сервис проверяет у nhentai, что ключ этого аккаунта.
 */
import { createApiKey, listApiKeys } from "../api/account";
import { hasUserSession, loadAccountKey, storeAccountKey } from "../api/client";
import { getCaptchaInfo, getPowChallenge, solvePoW } from "../api/config";
import { hasAccountKey, rememberAccountKey } from "./nhAccounts";
import { isNhLinked, pushNhKey, refreshNhLinks } from "./mlNhentai";
import { mlSignedIn } from "./mlid";
import { currentNhUserId, requestCaptcha, type CaptchaLabels } from "./session";

/** Имя ключа на сайте — по нему его видно в списке ключей. */
export const KEY_NAME = "MoeLibre";

export type KeyResult = "ok" | "exists" | "no-session" | "captcha" | "failed";

let running: Promise<KeyResult> | null = null;

/**
 * Создать ключ текущему аккаунту, если его ещё нет на устройстве, и отдать в привязку MoeLibre.
 * Капча открывается окном (как при входе). Повторные вызовы во время работы ждут тот же.
 */
export function ensureAccountKey(labels: CaptchaLabels): Promise<KeyResult> {
  running ??= run(labels).finally(() => (running = null));
  return running;
}

async function run(labels: CaptchaLabels): Promise<KeyResult> {
  const id = currentNhUserId();
  if (!id) return "no-session";
  if (hasAccountKey(id)) {
    await shareKey(id, loadAccountKey());
    return "exists";
  }
  if (!hasUserSession()) return "no-session";
  try {
    const captcha = await getCaptchaInfo();
    if (!captcha.site_key) return "captcha";
    const token = await requestCaptcha(captcha.site_key, captcha.provider, labels);
    if (!token) return "captcha";
    const pow = await getPowChallenge("api_key");
    const nonce = await solvePoW(pow.challenge, pow.difficulty);
    // Аккаунт могли сменить, пока решали капчу
    if (currentNhUserId() !== id) return "failed";
    const created = await createApiKey({ name: KEY_NAME, purpose: "MoeLibre app: keeps the account signed in across devices", pow_challenge: pow.challenge, pow_nonce: nonce, captcha_response: token });
    rememberAccountKey(id, created.key);
    if (currentNhUserId() === id) storeAccountKey(created.key);
    await shareKey(id, created.key);
    return "ok";
  } catch {
    return "failed";
  }
}

/** Ключ — в привязку MoeLibre (если аккаунт к ней привязан). */
async function shareKey(id: number, key: string | null) {
  if (!key || !mlSignedIn()) return;
  if (!isNhLinked(id)) await refreshNhLinks();
  if (!isNhLinked(id)) return;
  await pushNhKey(id, key).catch(() => undefined);
}

/** Ключи «MoeLibre» на сайте у текущего аккаунта (для экрана аккаунтов: сколько их уже создано). */
export async function countSiteKeys(): Promise<number> {
  try {
    return (await listApiKeys()).filter((k) => k.name === KEY_NAME).length;
  } catch {
    return 0;
  }
}
