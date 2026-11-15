/**
 * Ресурсы MoeLibre: сайты, которые открываются во вкладках браузера (ПК).
 * Сейчас работает только nhentai — его интерфейс и есть всё текущее приложение; остальные
 * показываются в выборе ресурса как «скоро». У ресурса будет свой интерфейс под строкой вкладок.
 */

export interface ResourceDef {
  id: string;
  name: string;
  /** Сайт ресурса — для подписи в выборе и адресной строки. */
  host: string;
  /** Цвет значка (буква на цветной плашке). */
  color: string;
  /** Буквы на значке. */
  mark: string;
  available: boolean;
}

export const RESOURCES: ResourceDef[] = [
  { id: "nhentai", name: "nhentai", host: "nhentai.net", color: "#ed2553", mark: "nh", available: true },
  { id: "rule34", name: "Rule34", host: "rule34.xxx", color: "#3f9b4b", mark: "r34", available: false },
  { id: "ehentai", name: "E-Hentai", host: "e-hentai.org", color: "#8a5a44", mark: "eh", available: false },
  { id: "hitomi", name: "Hitomi", host: "hitomi.la", color: "#3b6fd4", mark: "hi", available: false },
  { id: "danbooru", name: "Danbooru", host: "danbooru.donmai.us", color: "#9b59b6", mark: "db", available: false },
];

export const DEFAULT_RESOURCE = "nhentai";

export function resourceById(id: string): ResourceDef {
  return RESOURCES.find((r) => r.id === id) ?? RESOURCES[0];
}
