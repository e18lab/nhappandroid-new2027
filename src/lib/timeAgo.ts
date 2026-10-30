/** «3 дня назад» — перенос `utils/book/timeAgo.ts` старого приложения (те же формы и склонения). */
import type { ResolvedLocale } from "../i18n/I18nContext";

type UnitKey = "year" | "month" | "day" | "hour" | "minute" | "second";

const translations: Record<ResolvedLocale, { units: Record<UnitKey, string[]>; justNow: string; ago: string }> = {
  en: {
    units: {
      year: ["year", "years"],
      month: ["month", "months"],
      day: ["day", "days"],
      hour: ["hour", "hours"],
      minute: ["minute", "minutes"],
      second: ["second", "seconds"],
    },
    justNow: "just now",
    ago: "ago",
  },
  ru: {
    units: {
      year: ["год", "года", "лет"],
      month: ["месяц", "месяца", "месяцев"],
      day: ["день", "дня", "дней"],
      hour: ["час", "часа", "часов"],
      minute: ["минута", "минуты", "минут"],
      second: ["секунда", "секунды", "секунд"],
    },
    justNow: "только что",
    ago: "назад",
  },
  zh: {
    units: { year: ["年"], month: ["个月"], day: ["天"], hour: ["小时"], minute: ["分钟"], second: ["秒"] },
    justNow: "刚刚",
    ago: "前",
  },
  ja: {
    units: { year: ["年"], month: ["ヶ月"], day: ["日"], hour: ["時間"], minute: ["分"], second: ["秒"] },
    justNow: "たった今",
    ago: "前",
  },
};

function pluralRu(n: number, forms: string[]): string {
  if (n % 10 === 1 && n % 100 !== 11) return forms[0];
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return forms[1];
  return forms[2];
}

const TABLE: [UnitKey, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

export function timeAgo(input: string | number | Date, locale: ResolvedLocale): string {
  const date =
    input instanceof Date
      ? input
      : typeof input === "string"
        ? new Date(Date.parse(input) || Date.now())
        : new Date(input < 1e12 ? input * 1000 : input);
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const tr = translations[locale];
  for (const [unit, secs] of TABLE) {
    if (s < secs) continue;
    const v = Math.floor(s / secs);
    if (locale === "ru") return `${v} ${pluralRu(v, tr.units[unit])} ${tr.ago}`;
    if (locale === "zh" || locale === "ja") return `${v}${tr.units[unit][0]}${tr.ago}`;
    return `${v} ${tr.units[unit][v === 1 ? 0 : 1]} ${tr.ago}`;
  }
  return tr.justNow;
}
