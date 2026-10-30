/**
 * Перевод комментариев через MyMemory — как `translateViaMyMemory` в старом `CommentCard.tsx`.
 * Язык текста определяется по письменности (старое приложение использовало franc-min):
 * кириллица → ru, кана → ja, иероглифы → zh, хангыль → ko, остальное → en.
 */
const MYMEMORY = "https://api.mymemory.translated.net/get";

const ERROR_PHRASES = [
  "QUERY LENGTH LIMIT EXCEDEED",
  "MYMEMORY WARNING",
  "YOU USED ALL AVAILABLE FREE TRANSLATIONS",
  "PLEASE SELECT TWO DISTINCT LANGUAGES",
  "INVALID LANGUAGE PAIR",
];

export function detectLanguage(text: string): string {
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[一-鿿]/.test(text)) return "zh-CN";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  return "en";
}

/** Код MyMemory для языка интерфейса. */
export const targetLanguage = (locale: string) => (locale === "zh" ? "zh-CN" : locale);

async function httpGet(url: string): Promise<Response> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(url, { method: "GET", connectTimeout: 15_000 });
  }
  return fetch(url);
}

/** Режет текст по пробелам на куски до 450 символов (лимит MyMemory — 500). */
function chunks(text: string, max = 450): string[] {
  const parts: string[] = [];
  let s = text;
  while (s.length > max) {
    let cut = s.lastIndexOf(" ", max);
    if (cut === -1) cut = max;
    parts.push(s.slice(0, cut));
    s = s.slice(cut).trimStart();
  }
  if (s) parts.push(s);
  return parts;
}

async function translateChunk(text: string, pair: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await httpGet(`${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`);
      const data = (await res.json()) as {
        responseStatus?: number;
        quotaFinished?: boolean;
        responseData?: { translatedText?: string };
      };
      const status = data.responseStatus ?? res.status;
      const out = data.responseData?.translatedText ?? "";
      if (data.quotaFinished || status === 403 || status === 429) throw new Error("quota");
      if (!res.ok || ERROR_PHRASES.some((e) => out.toUpperCase().includes(e))) throw new Error("api_error");
      return out || text;
    } catch (e) {
      const fatal = e instanceof Error && (e.message === "quota" || e.message === "api_error");
      if (fatal || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

export async function translateText(text: string, to: string): Promise<string> {
  const pair = `${detectLanguage(text)}|${to}`;
  const out: string[] = [];
  for (const part of chunks(text)) {
    out.push(await translateChunk(part, pair));
    await new Promise((r) => setTimeout(r, 400));
  }
  return out.join(" ");
}
