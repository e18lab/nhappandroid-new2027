/**
 * Вход и сессии — перенос `api/v2/auth.ts`.
 *
 * POST   /auth/login | /auth/register   Вход / регистрация (PoW + капча)
 * POST   /auth/refresh                  Новая пара токенов
 * POST   /auth/logout | /auth/logout/all
 * GET    /auth/sessions                 Активные сессии
 * DELETE /auth/sessions/{id}
 * POST   /auth/reset | /auth/reset/confirm  Сброс пароля
 *
 * Очистка локальных данных при выходе (`clearUserLocalDataOnLogout`) появится вместе с этапом 6.
 */
import { clearTokens, loadRefreshToken, nhApi, storeTokens } from "./client";
import type { AuthTokens, Session, SuccessResponse } from "./types";

/** Поля защиты от ботов: задача PoW (`getPowChallenge(action)`), её решение и ответ капчи. */
export interface PowFields {
  pow_challenge: string;
  pow_nonce: string;
  captcha_response?: string;
}

const NO_AUTH = { public: true, skipRefresh: true } as const;

export async function login(params: { username: string; password: string } & PowFields): Promise<AuthTokens> {
  const result = await nhApi.post<AuthTokens>("/auth/login", params, NO_AUTH);
  storeTokens(result.access_token, result.refresh_token);
  return result;
}

export async function register(
  params: { username: string; email: string; password: string } & PowFields,
): Promise<AuthTokens> {
  const result = await nhApi.post<AuthTokens>("/auth/register", params, NO_AUTH);
  storeTokens(result.access_token, result.refresh_token);
  return result;
}

/** Вызывается клиентом на 401; токены сохраняет вызывающий. */
export function refresh(refreshToken?: string): Promise<AuthTokens> {
  const token = refreshToken ?? loadRefreshToken();
  if (!token) return Promise.reject(new Error("No refresh token available"));
  return nhApi.post<AuthTokens>("/auth/refresh", { refresh_token: token }, NO_AUTH);
}

/** Отозвать текущую сессию на сервере (если получится) и забыть токены. */
export async function logout(): Promise<void> {
  const refreshToken = loadRefreshToken();
  if (refreshToken) {
    try {
      await nhApi.post<SuccessResponse>("/auth/logout", { refresh_token: refreshToken }, { skipRefresh: true });
    } catch {
      /* выходим локально в любом случае */
    }
  }
  clearTokens();
}

export async function logoutAll(): Promise<SuccessResponse> {
  const result = await nhApi.post<SuccessResponse>("/auth/logout/all", {});
  clearTokens();
  return result;
}

export function getSessions(): Promise<Session[]> {
  const token = loadRefreshToken();
  return nhApi.get("/auth/sessions", { headers: token ? { "x-refresh-token": token } : undefined });
}

export function revokeSession(sessionId: string): Promise<SuccessResponse> {
  return nhApi.delete(`/auth/sessions/${sessionId}`);
}

export function requestPasswordReset(params: { email: string } & PowFields): Promise<SuccessResponse> {
  return nhApi.post("/auth/reset", params, NO_AUTH);
}

export function confirmPasswordReset(params: { token: string; new_password: string } & PowFields): Promise<SuccessResponse> {
  return nhApi.post("/auth/reset/confirm", params, NO_AUTH);
}
