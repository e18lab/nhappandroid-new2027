/**
 * Служебные эндпоинты — перенос `api/v2/config.ts` (CDN-часть уже в `media.ts`).
 *
 * GET /          Версия API
 * GET /config    CDN и объявление
 * GET /pow       Задача Proof-of-Work (вход, регистрация, комментарий)
 * GET /captcha   Провайдер и ключ капчи
 */
import { apiGet, buildQuery } from "./client";
import type { AppSiteConfig, CaptchaInfo, PowChallenge } from "./types";

export function getApiRoot(): Promise<{ version: string; message: string }> {
  return apiGet("", { public: true });
}

export function getSiteConfig(): Promise<AppSiteConfig> {
  return apiGet("/config", { public: true });
}

/** Сложность зависит от действия: "login" | "register" | "comment" | "reset". */
export function getPowChallenge(action?: string): Promise<PowChallenge> {
  return apiGet(`/pow${buildQuery({ action })}`, { public: true });
}

export async function getCaptchaInfo(): Promise<CaptchaInfo> {
  const raw = await apiGet<{ provider?: string; site_key?: string; public_key?: string }>("/captcha", { public: true });
  return { provider: raw.provider ?? "turnstile", site_key: (raw.site_key ?? raw.public_key ?? "").trim() };
}

// ─── Решение PoW ──────────────────────────────────────────────────────────────

/**
 * Подбирает nonce, при котором sha256(challenge + nonce) начинается с `difficulty` нулевых бит.
 * Считает пачками по 2000 и отдаёт управление между ними, чтобы интерфейс не замирал.
 */
export async function solvePoW(challenge: string, difficulty: number): Promise<string> {
  const BATCH = 2_000;
  let nonce = 0;
  for (;;) {
    const end = nonce + BATCH;
    for (; nonce < end; nonce++) {
      if (hashMeetsDifficulty(sha256Hex(challenge + nonce), difficulty)) return String(nonce);
    }
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

function hashMeetsDifficulty(hex: string, difficulty: number): boolean {
  const zeroNibbles = Math.floor(difficulty / 4);
  const remainder = difficulty % 4;
  if (!hex.startsWith("0".repeat(zeroNibbles))) return false;
  if (remainder === 0) return true;
  return parseInt(hex[zeroNibbles], 16) < 2 ** (4 - remainder);
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const encoder = new TextEncoder();
const w = new Int32Array(64);

/** Синхронный SHA-256 (hex в нижнем регистре). */
export function sha256Hex(message: string): string {
  const data = encoder.encode(message);
  const bitLen = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getInt32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15];
      const b = w[t - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const tmp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const tmp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + tmp1) | 0;
      d = c; c = b; b = a; a = (tmp1 + tmp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}
