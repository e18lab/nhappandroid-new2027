/**
 * REST своего бэкенда (nappi) — перенос `api/nhappApi/users.ts` и части `cloudStorage.ts`.
 * Сервер открыт для CORS, поэтому хватает обычного fetch (адрес разрешён в CSP).
 * Ошибки здесь не критичны: вызывающие глушат их, как старое приложение.
 */
import { version } from "../../package.json";
import { API_BASE_URL, API_TIMEOUT_MS } from "../config/api";

export const APP_VERSION: string = version;

async function request(path: string, init: RequestInit & { userId?: number } = {}): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(userId != null ? { "x-user-id": String(userId) } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
}

/** Регистрация пользователя и устройства на сервере (`useOnlineMe` в старом). */
export async function syncUser(params: {
  id: number;
  username: string;
  deviceId: string;
  deviceName: string;
}): Promise<void> {
  await request("/api/users/sync", { method: "POST", body: JSON.stringify({ ...params, appVersion: APP_VERSION }) });
}

/** Отметить пользователя онлайн (last_online_at + last_seen устройства). */
export async function touchOnline(userId: number, deviceId: string): Promise<void> {
  await request("/api/users/me/online", { method: "PATCH", userId, body: JSON.stringify({ deviceId }) });
}
