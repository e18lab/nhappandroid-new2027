/**
 * Настоящие значки способов входа MoeLibre ID: многоцветная «G» Google и самолётик Telegram в круге.
 * `inverse` у Telegram — белый круг с синим самолётиком (для синей кнопки «Войти через Telegram»).
 */
export type ProviderId = "google" | "telegram";

export function ProviderMark({ provider, size = 20, inverse = false }: { provider: ProviderId | string; size?: number; inverse?: boolean }) {
  if (provider === "google") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="provider-mark">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    );
  }
  if (provider === "telegram") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="provider-mark">
        <circle cx="12" cy="12" r="12" fill={inverse ? "#fff" : "#2AABEE"} />
        <path
          fill={inverse ? "#2AABEE" : "#fff"}
          d="M5.43 11.87l11.57-4.46c.54-.2 1 .13.83.95l-1.97 9.28c-.15.66-.54.82-1.09.51l-3.02-2.22-1.46 1.4c-.16.16-.3.3-.61.3l.22-3.06 5.57-5.03c.24-.21-.05-.33-.37-.12l-6.88 4.33-2.97-.93c-.64-.2-.66-.64.14-.95z"
        />
      </svg>
    );
  }
  return null;
}
