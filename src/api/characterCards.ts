/**
 * Карточки персонажей на сервере nappi — перенос `api/nhappApi/characterCards.ts`.
 * Рамка `rect` — доли ширины и высоты исходной страницы.
 */
import { API_BASE_URL, API_TIMEOUT_MS } from "../config/api";

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterCatalogItem {
  characterName: string;
  parodyName: string | null;
  cardsCount: number;
  imageUrl: string | null;
  rect: CardRect | null;
  userId: number | null;
  userName: string | null;
  cardId: number | null;
  bookExternalId: number | null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res;
}

export async function getCharacterCatalog(): Promise<CharacterCatalogItem[]> {
  const res = await request("/api/character-cards/catalog");
  return ((await res.json()) as { items?: CharacterCatalogItem[] }).items ?? [];
}

export async function updateCharacterCard(
  id: number,
  card: { characterName: string; parodyName: string | null; imageUrl: string; rect: CardRect; userId: number },
): Promise<void> {
  await request(`/api/character-cards/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      characterName: card.characterName,
      parodyName: card.parodyName,
      imageUrl: card.imageUrl,
      cropX: card.rect.x,
      cropY: card.rect.y,
      cropWidth: card.rect.width,
      cropHeight: card.rect.height,
      userId: card.userId,
      user_id: card.userId,
    }),
  });
}

export async function deleteCharacterCard(id: number, userId: number): Promise<void> {
  await request(`/api/character-cards/${id}?userId=${userId}&user_id=${userId}`, { method: "DELETE" });
}
