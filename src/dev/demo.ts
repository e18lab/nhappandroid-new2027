/**
 * Демо-режим для скриншотов (только `npm run dev` в браузере, адрес с `?demo`): аккаунт-заглушка MoeLibre ID
 * без сети и без чужих данных — запросы к ID, облаку и mlnappi отвечаются здесь, сокет облака подменён.
 * Должен загрузиться первым (`main.tsx`): кладёт вход в localStorage до того, как его прочитает `mlid.ts`.
 */
const ON = import.meta.env.DEV && typeof window !== "undefined" && /[?&]demo/.test(window.location.search);

if (ON) {
  const ID = (import.meta.env.VITE_ML_ID_URL || "https://id.moelibre.cc").replace(/\/+$/, "");
  const CLOUD = (import.meta.env.VITE_ML_CLOUD_URL || "https://cloud.moelibre.cc").replace(/\/+$/, "");
  const NH = (import.meta.env.VITE_ML_NH_URL || "https://mlnappi.moelibre.cc").replace(/\/+$/, "");
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  const account = {
    id: "00000000-0000-4000-8000-00000000a9e5",
    display_name: "Agnes",
    avatar_url: `${location.origin}/src/dev/demo-avatar.jpg`,
    created_at: "2026-11-15T09:00:00Z",
    mfa: true,
  };
  localStorage.setItem("@auth.mlid", JSON.stringify({ access: "demo", accessExp: Date.now() + 365 * 86_400_000, refresh: "demo", account }));

  // `&lang=en|ru|zh|ja` — язык интерфейса; `&open=/mlid` — экран после запуска; `&sort=` — сортировка каталога
  const params = new URLSearchParams(location.search);
  const lang = params.get("lang");
  if (lang && ["en", "ru", "zh", "ja"].includes(lang)) localStorage.setItem("app_language", lang);
  // `&sort=popular-month` — сортировка каталога (date | popular | popular-today | popular-week | popular-month)
  const sort = params.get("sort");
  if (sort && ["date", "popular", "popular-today", "popular-week", "popular-month"].includes(sort)) localStorage.setItem("searchSortPref", sort);
  const open = params.get("open");
  if (open) {
    window.setTimeout(() => {
      void Promise.all([import("../lib/platform"), import("../browser/tabs")]).then(([p, t]) => {
        if (p.IS_DESKTOP) t.getActiveRouter().navigate(open);
        else location.hash = `#${open}`;
      });
    }, 1500);
  }

  const me = {
    account,
    session_id: "demo-s1",
    identities: [
      { provider: "telegram", email: null, display_name: "Agnes", avatar_url: null, created_at: ago(3000), last_login_at: ago(30) },
      { provider: "google", email: null, display_name: "Agnes", avatar_url: null, created_at: ago(2900), last_login_at: ago(600) },
    ],
    links: [],
  };
  const sessions = {
    current: "demo-s1",
    sessions: [
      { id: "demo-s1", device_id: "demo-pc", device_name: "Windows", created_at: ago(3000), last_used_at: ago(0) },
      { id: "demo-s2", device_id: "demo-phone", device_name: "Xiaomi 14", created_at: ago(2500), last_used_at: ago(12) },
      { id: "demo-s3", device_id: "demo-laptop", device_name: "Windows", created_at: ago(2000), last_used_at: ago(180) },
    ],
  };
  const cloud = {
    enabled: true,
    enabled_at: "2026-11-15T09:10:00Z",
    vault: true,
    granted: true,
    parts: [
      { part: "app", bytes: 18_400, keys: 42, updated_at: ago(2) },
      { part: "res:nhentai", bytes: 96_200, keys: 18, updated_at: ago(2) },
    ],
    imports: [],
  };

  const routes: [string, (url: URL, init?: RequestInit) => unknown][] = [
    [`${ID}/me/mfa`, () => ({ enabled: true, recovery_left: 10 })],
    [`${ID}/me/sessions`, () => sessions],
    [`${ID}/me`, () => me],
    [`${ID}/auth/providers`, () => ({ google: true, telegram: true })],
    [`${CLOUD}/v1/cloud`, () => cloud],
    [`${NH}/v1/link`, () => ({ linked: false, accounts: [] })],
  ];

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (raw.startsWith(ID) || raw.startsWith(CLOUD) || raw.startsWith(NH)) {
      const url = new URL(raw);
      const path = `${url.origin}${url.pathname}`;
      const hit = routes.find(([p]) => path === p);
      const method = (init?.method ?? "GET").toUpperCase();
      if (!hit || method !== "GET") return new Response(null, { status: 204 });
      return new Response(JSON.stringify(hit[1](url, init)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  };

  // Сокет облака: подключено, два устройства в сети, недавняя синхронизация
  const RealWS = window.WebSocket;
  class DemoSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor() {
      super();
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
      }, 50);
    }
    private emit(msg: unknown) {
      setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(msg) })), 30);
    }
    send(raw: string) {
      const msg = JSON.parse(raw) as { type: string; id?: number; t?: number; part?: string; parts?: string[]; deviceId?: string; deviceName?: string };
      if (msg.type === "auth") {
        this.emit({ type: "ready", enabled: true, vault: true, granted: true });
        this.emit({
          type: "peers",
          count: 2,
          devices: [
            { device_id: msg.deviceId, device_name: msg.deviceName },
            { device_id: "demo-phone", device_name: "Xiaomi 14" },
          ],
          lastSync: { at: Date.now() - 4 * 60_000, fromDeviceId: msg.deviceId, part: "app", keysCount: 3, recipientCount: 1 },
          serverTime: Date.now(),
        });
      } else if (msg.type === "ping") this.emit({ type: "pong", id: msg.id, t: msg.t, serverTime: Date.now() - 46 });
      else if (msg.type === "sub") for (const part of msg.parts ?? []) this.emit({ type: "part", part, data: {} });
      else if (msg.type === "push") this.emit({ type: "ack", id: msg.id, part: msg.part, echo: {} });
    }
    close() {
      this.readyState = 3;
      this.onclose?.(new CloseEvent("close"));
    }
  }
  window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
    return String(url).startsWith(CLOUD.replace(/^http/, "ws")) ? new DemoSocket() : new RealWS(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
}

export {};
