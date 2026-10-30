/**
 * Идентификатор и имя устройства для сессий и облачной синхронизации — перенос `utils/deviceId.ts`.
 * Android: ANDROID_ID и «производитель модель» из нативного моста (`SystemUi.kt`) — те же значения,
 * что отдавало старое приложение, поэтому сервер узнаёт телефон после обновления.
 * Остальные платформы: UUID, созданный один раз и сохранённый в `@cloud.deviceId`.
 */
import "../shell/systemUi";
import { KEYS, getItem, setItem } from "./storage";

export function getDeviceId(): string {
  try {
    const id = window.NHAppNative?.deviceId?.();
    if (id) return id;
  } catch {
    /* мост недоступен */
  }
  const stored = getItem(KEYS.cloudDeviceId);
  if (stored) return stored;
  const id = crypto.randomUUID();
  setItem(KEYS.cloudDeviceId, id);
  return id;
}

export function getDeviceName(): string {
  try {
    const name = window.NHAppNative?.deviceName?.();
    if (name) return name;
  } catch {
    /* мост недоступен */
  }
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Устройство";
}
