export type SortOrder =
  | "date"
  | "popular"
  | "popular-today"
  | "popular-week"
  | "popular-month";

export type TagType = "tag" | "artist" | "parody" | "character" | "group" | "language" | "category";

// ─── Галереи ──────────────────────────────────────────────────────────────────

/** Карточка в списках и поиске. */
export interface GalleryCard {
  id: number;
  media_id: string;
  thumbnail: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  english_title?: string;
  japanese_title?: string;
  num_pages?: number;
  num_favorites?: number;
  upload_date?: number;
  tag_ids?: number[];
  scanlator?: string;
}

/** Похожие (GET /galleries/{id}/related) — та же карточка, media_id может не прийти. */
export type GalleryRelated = Omit<GalleryCard, "media_id"> & { media_id?: string };

export interface Paginated<T> {
  result: T[];
  num_pages: number;
  per_page: number;
  total: number;
}

export interface Tag {
  id: number;
  type: string;
  name: string;
  slug?: string;
  url?: string;
  count?: number;
}

export interface GalleryImage {
  path: string;
  width?: number;
  height?: number;
}

export interface GalleryPage {
  number: number;
  path: string;
  width?: number;
  height?: number;
  thumbnail?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

export interface GalleryPagesResponse {
  gallery_id: number;
  media_id: string;
  num_pages: number;
  pages: GalleryPage[];
}

export interface GalleryPageResponse {
  gallery_id: number;
  media_id: string;
  page: GalleryPage;
  num_pages: number;
  is_first_page: boolean;
  is_last_page: boolean;
  next_page: number | null;
  previous_page: number | null;
}

export interface Gallery {
  id: number;
  media_id: string;
  title: {
    english: string;
    japanese: string;
    pretty: string;
  };
  cover?: GalleryImage;
  thumbnail?: GalleryImage | string;
  scanlator?: string;
  upload_date?: number;
  tags: Tag[];
  num_pages: number;
  num_favorites: number;
  pages?: GalleryPage[];
  comments?: Comment[];
  related?: GalleryRelated[];
  is_favorited?: boolean;
}

export interface CdnConfig {
  image_servers?: string[];
  thumb_servers?: string[];
}

/** GET /config — CDN и объявление. */
export interface AppSiteConfig extends CdnConfig {
  announcement?: string | null;
}

export interface PowChallenge {
  challenge: string;
  difficulty: number;
}

/** GET /captcha — поле `site_key` (в старых ответах `public_key`). */
export interface CaptchaInfo {
  provider: string;
  site_key: string;
}

// ─── Аккаунт ──────────────────────────────────────────────────────────────────

export interface UserLite {
  id: number;
  username: string;
  slug: string;
  avatar_url: string;
  is_staff: boolean;
  is_superuser: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  user: UserLite;
}

export interface Session {
  id: string;
  created_at: number;
  expires_at: number;
  ip_address: string;
  user_agent: string;
  current: boolean;
}

export interface Me extends UserLite {
  email: string;
  theme?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_preview: string;
  created_at: number;
  last_used_at: number | null;
}

export interface UserProfile {
  id: number;
  username: string;
  slug: string;
  avatar_url: string;
  is_superuser: boolean;
  is_staff: boolean;
  date_joined: number;
  about: string;
  favorite_tags: string;
  recent_favorites: {
    id: number;
    thumbnail: string;
    thumbnail_width: number;
    thumbnail_height: number;
    english_title: string;
    japanese_title: string;
  }[];
  recent_comments: {
    id: number;
    gallery_id: number;
    body: string;
    post_date: number;
    gallery_title: string;
  }[];
}

// ─── Комментарии, чёрный список ───────────────────────────────────────────────

export interface Comment {
  id: number;
  gallery_id: number;
  poster: UserLite;
  post_date: number;
  body: string;
}

export interface TagShort {
  id: number;
  type: string;
  name: string;
  slug: string;
  count: number;
}

export interface Blacklist {
  tags: TagShort[];
  count: number;
}

export interface SuccessResponse {
  success: boolean;
  message?: string;
}
