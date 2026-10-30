/**
 * Модель книги для экранов — как `Book` старого приложения (`api/v2/compat.ts`).
 * Обложки и страницы хранятся путями API; полные адреса с запасными зеркалами строит `media.ts`.
 */
import type { Gallery, GalleryCard, GalleryRelated, Tag } from "./types";

export interface BookPage {
  /** Номер страницы с 1. */
  page: number;
  path: string;
  thumb?: string;
  width?: number;
  height?: number;
}

export interface Book {
  id: number;
  title: { english: string; japanese: string; pretty: string };
  /** ISO-дата загрузки или "" */
  uploaded: string;
  mediaId: string;
  favorites: number;
  pagesCount: number;
  scanlator: string;
  tags: Tag[];
  artists: Tag[];
  characters: Tag[];
  parodies: Tag[];
  groups: Tag[];
  categories: Tag[];
  languages: Tag[];
  tagIds: number[];
  /** Путь обложки (thumb-CDN). */
  cover: string;
  coverW?: number;
  coverH?: number;
  thumbnail: string;
  pages: BookPage[];
  /** Полные данные загружены (теги, дата) — для карточек списка. */
  full: boolean;
}

const byType = (tags: Tag[], type: string) => tags.filter((t) => t.type === type);

export function galleryCardToBook(c: GalleryCard | GalleryRelated): Book {
  return {
    id: c.id,
    title: { english: c.english_title ?? "", japanese: c.japanese_title ?? "", pretty: c.english_title ?? "" },
    uploaded: c.upload_date ? new Date(c.upload_date * 1000).toISOString() : "",
    mediaId: c.media_id ?? "",
    favorites: c.num_favorites ?? 0,
    pagesCount: c.num_pages ?? 0,
    scanlator: "",
    tags: [],
    artists: [],
    characters: [],
    parodies: [],
    groups: [],
    categories: [],
    languages: [],
    tagIds: c.tag_ids ? [...c.tag_ids] : [],
    cover: c.thumbnail,
    coverW: c.thumbnail_width,
    coverH: c.thumbnail_height,
    thumbnail: c.thumbnail,
    pages: [],
    full: false,
  };
}

/** Похожие приходят карточками без media_id — та же модель, обложка по полному пути. */
export const galleryRelatedToBook = galleryCardToBook;

export function galleryToBook(g: Gallery): Book {
  const thumb = typeof g.thumbnail === "string" ? g.thumbnail : g.thumbnail?.path ?? "";
  return {
    id: g.id,
    title: { english: g.title.english ?? "", japanese: g.title.japanese ?? "", pretty: g.title.pretty ?? g.title.english ?? "" },
    uploaded: g.upload_date ? new Date(g.upload_date * 1000).toISOString() : "",
    mediaId: g.media_id,
    favorites: g.num_favorites ?? 0,
    pagesCount: g.num_pages ?? 0,
    scanlator: g.scanlator ?? "",
    tags: g.tags,
    artists: byType(g.tags, "artist"),
    characters: byType(g.tags, "character"),
    parodies: byType(g.tags, "parody"),
    groups: byType(g.tags, "group"),
    categories: byType(g.tags, "category"),
    languages: byType(g.tags, "language"),
    tagIds: g.tags.map((t) => t.id),
    // Обложка — только с thumb-CDN (с i* отдаёт ошибку), как в старом galleryToBook
    cover: g.cover?.path || thumb,
    coverW: g.cover?.width,
    coverH: g.cover?.height,
    thumbnail: thumb,
    pages: (g.pages ?? []).map((p) => ({
      page: p.number,
      path: p.path,
      thumb: p.thumbnail,
      width: p.width,
      height: p.height,
    })),
    full: true,
  };
}

/** Дополнить карточку списка полными данными, не теряя то, что уже было. */
export function mergeBook(base: Book, full: Book): Book {
  return {
    ...base,
    ...full,
    title: {
      english: full.title.english || base.title.english,
      japanese: full.title.japanese || base.title.japanese,
      pretty: full.title.pretty || base.title.pretty,
    },
    cover: base.cover || full.cover,
    thumbnail: base.thumbnail || full.thumbnail,
  };
}

const LANG_TAG_JP = 6346;
const LANG_TAG_CN = 29963;
const LANG_TAG_EN = 12227;

/** Язык книги: из тегов языка («translated» пропускается), иначе по известным id тегов. */
export function bookLanguage(book: Book): string | undefined {
  const langs = book.languages;
  if (langs.length) {
    const first = langs[0]?.name?.toLowerCase();
    const second = langs[1]?.name?.toLowerCase();
    return first === "translated" && second ? second : first;
  }
  for (const id of book.tagIds) {
    if (id === LANG_TAG_JP) return "japanese";
    if (id === LANG_TAG_CN) return "chinese";
    if (id === LANG_TAG_EN) return "english";
  }
  return undefined;
}
