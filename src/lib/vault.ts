/**
 * Ключ защиты облака — второй фактор MoeLibre Cloud.
 *
 * Ключ (160 бит, вида `ABCD-EFGH-…`, 8 групп) создаётся на устройстве и показывается пользователю один раз —
 * сохранить его должен он сам. Из ключа (HKDF-SHA256, соль — id аккаунта MoeLibre) выводятся:
 *  - ключ шифрования AES-256-GCM — им шифруются секреты (токены и ключи API nhentai) перед отправкой в облако;
 *    он никогда не покидает устройства;
 *  - ключ проверки — уходит на сервер, там хранится только его sha256. По нему сервер пускает устройство в облако,
 *    но ни расшифровать секреты, ни подобрать ключ по нему нельзя.
 * Утечка базы облака: история и настройки читаются (их видит администратор для рекомендаций), секреты — нет.
 * Новое устройство: войти в MoeLibre ID и ввести ключ защиты — без него облако на устройстве не включается.
 * Ключ хранится на устройстве (`@local.` — в облако не уходит), у каждого аккаунта MoeLibre свой.
 */
import { useSyncExternalStore } from "react";
import { getDeviceId } from "./device";
import { getMlAccount, mlFetch } from "./mlid";
import { getItem, removeItem, setItem } from "./storage";

const ML_CLOUD_URL: string = (import.meta.env.VITE_ML_CLOUD_URL || "https://cloud.moelibre.cc").replace(/\/+$/, "");
const SECRET_PREFIX = "@local.vault.secret.";
/** 32 символа без похожих (нет 0/O и 1/I; введённые I и 1 читаются как L). */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SECRET_BYTES = 20;
const SECRET_CHARS = 32;

const enc = new TextEncoder();
const listeners = new Set<() => void>();

/** Ключ защиты на этом устройстве появился или сменился. */
export function subscribeVault(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const secretKey = () => {
  const id = getMlAccount()?.id;
  return id ? SECRET_PREFIX + id : null;
};

/** Введён ли ключ защиты на этом устройстве. */
export function hasVaultSecret(): boolean {
  const k = secretKey();
  return !!k && !!getItem(k);
}

/** Введён ли ключ защиты на этом устройстве — для экранов. */
export function useVaultSecret(): boolean {
  return useSyncExternalStore(subscribeVault, hasVaultSecret);
}

// ─── Ключ: создание, запись, разбор ───────────────────────────────────────────

/** 20 байт → 32 символа (по 5 бит). */
function encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function decode(text: string): Uint8Array | null {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/[I1]/g, "L");
  if (clean.length !== SECRET_CHARS) return null;
  const out = new Uint8Array(SECRET_BYTES);
  let bits = 0;
  let value = 0;
  let i = 0;
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return out;
}

/** Ключ для показа: группы по 4. */
export const formatVaultKey = (raw: string) => raw.replace(/(.{4})(?=.)/g, "$1-");

/** Похоже ли введённое на ключ защиты (длина, символы). */
export const isVaultKeyLike = (text: string) => decode(text) != null;

interface Derived {
  enc: CryptoKey;
  /** Ключ проверки — hex. */
  auth: string;
}

const cache = new Map<string, Promise<Derived>>();

function derive(bytes: Uint8Array, accountId: string): Promise<Derived> {
  const id = `${accountId}:${encode(bytes)}`;
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const base = await crypto.subtle.importKey("raw", bytes as BufferSource, "HKDF", false, ["deriveKey", "deriveBits"]);
      const params = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: enc.encode(`moelibre:${accountId}`), info: enc.encode(info) });
      const key = await crypto.subtle.deriveKey(params("moelibre-vault-enc"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const bits = new Uint8Array(await crypto.subtle.deriveBits(params("moelibre-vault-auth"), base, 256));
      return { enc: key, auth: [...bits].map((b) => b.toString(16).padStart(2, "0")).join("") };
    })();
    cache.set(id, p);
  }
  return p;
}

function current(): Promise<Derived> | null {
  const k = secretKey();
  const accountId = getMlAccount()?.id;
  const raw = k ? getItem(k) : null;
  const bytes = raw ? decode(raw) : null;
  return bytes && accountId ? derive(bytes, accountId) : null;
}

function store(raw: string) {
  const k = secretKey();
  if (!k) return;
  setItem(k, raw);
  for (const l of listeners) l();
}

/** Забыть ключ на устройстве (выход из MoeLibre ID, ключ сменили на другом устройстве). */
export function forgetVaultSecret(): void {
  const k = secretKey();
  if (k && getItem(k) != null) {
    removeItem(k);
    for (const l of listeners) l();
  }
}

// ─── Сервер ───────────────────────────────────────────────────────────────────

async function call(path: string, bytes: Uint8Array): Promise<void> {
  const accountId = getMlAccount()?.id;
  if (!accountId) throw new Error("ml_signed_out");
  const { auth } = await derive(bytes, accountId);
  await mlFetch(`${ML_CLOUD_URL}/v1/cloud/vault${path}`, { method: "POST", body: JSON.stringify({ auth_key: auth, device_id: getDeviceId() }) });
}

/** Задать ключ защиты (его ещё нет у аккаунта). Возвращает ключ для показа — его надо сохранить. */
export async function createVaultKey(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  await call("", bytes);
  const raw = encode(bytes);
  store(raw);
  return formatVaultKey(raw);
}

/** Ввести ключ защиты на этом устройстве. */
export async function unlockVault(input: string): Promise<void> {
  const bytes = decode(input);
  if (!bytes) throw new Error("vault_bad_format");
  await call("/unlock", bytes);
  store(encode(bytes));
}

/** Новый ключ (старый потерян): остальные устройства теряют доступ, зашифрованные секреты в облаке стираются. */
export async function resetVaultKey(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  await call("/reset", bytes);
  const raw = encode(bytes);
  store(raw);
  return formatVaultKey(raw);
}

// ─── Шифрование ───────────────────────────────────────────────────────────────

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Зашифровать данные ключом защиты; null — ключа на устройстве нет. */
export async function sealJSON(data: unknown): Promise<string | null> {
  const d = current();
  if (!d) return null;
  const { enc: key } = await d;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data))));
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
}

/** Расшифровать; null — ключа нет, или данные зашифрованы другим ключом, или повреждены. */
export async function openJSON<T>(text: string): Promise<T | null> {
  const d = current();
  if (!d) return null;
  try {
    const box = JSON.parse(text) as { v?: number; iv?: string; ct?: string };
    if (box.v !== 1 || !box.iv || !box.ct) return null;
    const { enc: key } = await d;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
