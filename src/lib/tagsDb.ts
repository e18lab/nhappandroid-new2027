/**
 * Справочник тегов для экрана тегов — `api/nhentai-tags.json` старого приложения, ужатый
 * `scripts/build-tags-db.mjs`. Грузится отдельным файлом только при открытии экрана тегов.
 * Поиск и ранжирование — как `scoreByQuery` в старом `components/tags/helpers.ts`.
 */
export type TagKind = "tags" | "artists" | "characters" | "parodies" | "groups";
export type TagSingular = "tag" | "artist" | "character" | "parody" | "group";
export type TagMode = "include" | "exclude";

export interface TagItem {
  id: number;
  type: TagKind;
  name: string;
  count: number;
  low: string;
}

export const TAG_KINDS: TagKind[] = ["tags", "artists", "characters", "parodies", "groups"];

const SINGULAR: Record<TagKind, TagSingular> = {
  tags: "tag",
  artists: "artist",
  characters: "character",
  parodies: "parody",
  groups: "group",
};

export function toPlural(s: string): TagKind {
  const found = (Object.entries(SINGULAR) as [TagKind, TagSingular][]).find(([, v]) => v === s);
  return found ? found[0] : (s as TagKind);
}

export function toSingular(s: string): TagSingular {
  return SINGULAR[s as TagKind] ?? (s as TagSingular);
}

let all: TagItem[] | null = null;
let byKey: Map<string, TagItem> | null = null;
let loading: Promise<TagItem[]> | null = null;

const keyOf = (type: string, name: string) => `${toPlural(type)}:${name}`;

/** Все теги: сначала все теги, затем художники, персонажи, пародии, группы — внутри по популярности. */
export function loadTagsDb(): Promise<TagItem[]> {
  if (all) return Promise.resolve(all);
  if (!loading) {
    loading = import("../data/nhentai-tags.json").then((mod) => {
      const db = (mod.default ?? mod) as unknown as Record<TagKind, [number, string, number][]>;
      const list: TagItem[] = [];
      for (const type of TAG_KINDS) {
        for (const [id, name, count] of db[type] ?? []) list.push({ id, type, name, count, low: name.toLowerCase() });
      }
      all = list;
      byKey = new Map(list.map((t) => [keyOf(t.type, t.name), t]));
      return list;
    });
  }
  return loading;
}

/** Тег из справочника по типу (любое число) и имени; до загрузки справочника — undefined. */
export function findTag(type: string, name: string): TagItem | undefined {
  return byKey?.get(keyOf(type, name));
}

/** Заготовка строки для тега, которого нет в справочнике. */
export function tagStub(type: string, name: string): TagItem {
  return findTag(type, name) ?? { id: 0, type: toPlural(type), name, count: 0, low: name.toLowerCase() };
}

function score(t: TagItem, needle: string): number {
  const prefix = t.low.startsWith(needle) ? 3 : 0;
  const byWord = t.low.includes(` ${needle}`) ? 2 : 0;
  const substr = t.low.includes(needle) ? 1 : 0;
  return prefix * 1_000_000 + byWord * 100_000 + substr * 1_000 + t.count;
}

/** Без запроса — первые 300, с запросом — совпадения по релевантности, до 300 (как buildList). */
export function searchTags(base: TagItem[], needle: string, limit = 300): TagItem[] {
  if (!needle) return base.slice(0, limit);
  const filtered = base.filter((t) => t.low.includes(needle));
  filtered.sort((a, b) => score(b, needle) - score(a, needle));
  return filtered.slice(0, limit);
}
