/**
 * Адрес своего бэкенда (nappi) — перенос `config/api.ts`.
 * Старое приложение ходит на nappi.maks1mio.su, новое — на nappi.moelibre.cc (оба домена ведут на один сервер).
 * Для локальной разработки можно задать `VITE_API_BASE_URL` в `.env` (тогда домен нужно добавить
 * в CSP `tauri.conf.json` и в `capabilities/default.json`).
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL || "https://nappi.moelibre.cc").replace(/\/+$/, "");

/** WebSocket лобби (синк хранилища между устройствами) на том же хосте. */
export const LOBBY_WS_URL = `${API_BASE_URL.replace(/^http/, "ws")}/lobby`;

export const API_TIMEOUT_MS = 10000;
