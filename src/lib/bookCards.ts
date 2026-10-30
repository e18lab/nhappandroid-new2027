/**
 * Данные для карточек книг по id — закладки и история хранят только id.
 *
 * Старое приложение берёт их пачкой с сервера nhapp (`fetchBooksFromRecommendationLib`),
 * а недостающее догружает через GET /galleries/:id. Пока сервер nhapp не перенесён (этап 8),
 * используем только второй путь. Кеш в памяти, плюс карточки, которые уже видели в каталоге.
 */
import { cardTitle, getGallery } from "../api/galleries";
import type { Gallery, GalleryCard } from "../api/types";

export interface BookCardInfo {
  id: number;
  title: string;
  /** Путь превью из API (thumb или cover). */
  thumbnail: string;
  numPages?: number;
}

const CONCURRENCY = 6;
const cache = new Map<number, BookCardInfo>();

export function rememberCards(cards: GalleryCard[]): void {
  for (const c of cards) {
    cache.set(c.id, {
      id: c.id,
      title: cardTitle(c),
      thumbnail: c.thumbnail,
      numPages: c.num_pages,
    });
  }
}

export function rememberGallery(g: Gallery): BookCardInfo {
  const thumb =
    (typeof g.thumbnail === "string" ? g.thumbnail : g.thumbnail?.path) || g.cover?.path || "";
  const info: BookCardInfo = {
    id: g.id,
    title: g.title.pretty || g.title.english || g.title.japanese || `#${g.id}`,
    thumbnail: thumb,
    numPages: g.num_pages,
  };
  cache.set(g.id, info);
  return info;
}

export function cachedCard(id: number): BookCardInfo | undefined {
  return cache.get(id);
}

/**
 * Карточки для списка id в том же порядке. Кого не удалось загрузить — заглушка `#id`.
 * `onProgress` вызывается по мере загрузки, чтобы список заполнялся постепенно.
 */
export async function loadCards(
  ids: number[],
  onProgress?: (cards: BookCardInfo[]) => void,
): Promise<BookCardInfo[]> {
  const snapshot = () => ids.map((id) => cache.get(id) ?? placeholder(id));
  const missing = ids.filter((id) => !cache.has(id));

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(async (id) => {
        try {
          rememberGallery(await getGallery(id));
        } catch {
          /* остаётся заглушкой */
        }
      }),
    );
    onProgress?.(snapshot());
  }
  return snapshot();
}

function placeholder(id: number): BookCardInfo {
  return { id, title: `#${id}`, thumbnail: "" };
}
