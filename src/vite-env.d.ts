/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес бэкенда nappi, по умолчанию https://nappi.moelibre.cc */
  readonly VITE_API_BASE_URL?: string;
  /** Ключ API nhentai для анонимных запросов (необязателен) */
  readonly VITE_NHENTAI_API_KEY?: string;
}
