/**
 * Отладочный мост к MCP-серверу `tools/app-mcp` — только в режиме разработки (`import.meta.env.DEV`).
 * Подключается к ws://127.0.0.1:47321 и выполняет команды: состояние, JS, переход, нажатие, ввод, текст, логи.
 * Сервера нет — тихо пробует снова раз в несколько секунд. В сборку не попадает (импорт под `DEV`).
 * Токены и ключи наружу не отдаёт — только «есть / нет».
 */
import { getActiveRouter, getActiveTabId, getTabs } from "../browser/tabs";
import { getCloudState } from "../lib/cloudSync";
import { getMlAccount } from "../lib/mlid";
import { currentNhUserId } from "../lib/session";
import { IS_DESKTOP } from "../lib/platform";
import * as tabsMod from "../browser/tabs";
import * as sessionMod from "../lib/session";
import * as nhAccountsMod from "../lib/nhAccounts";
import * as clientMod from "../api/client";
import * as mlNhMod from "../lib/mlNhentai";

// Модули приложения для `app_eval` — те же экземпляры, что у приложения (динамический import после HMR
// может дать вторую копию модуля со своим состоянием)
(window as unknown as { __ml: unknown }).__ml = { tabs: tabsMod, session: sessionMod, nh: nhAccountsMod, client: clientMod, link: mlNhMod };

const URL = "ws://127.0.0.1:47321";
const RETRY_MS = 3000;

// ─── Логи консоли ─────────────────────────────────────────────────────────────

type LogEntry = { t: number; level: string; text: string };
const logs: LogEntry[] = [];
const LOG_MAX = 300;

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")
    .slice(0, 2000);
}

function push(level: string, text: string) {
  logs.push({ t: Date.now(), level, text });
  if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);
}

for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    push(level, fmt(args));
    orig(...args);
  };
}
window.addEventListener("error", (e) => push("error", `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => push("error", `unhandled: ${fmt([e.reason])}`));

// ─── Команды ──────────────────────────────────────────────────────────────────

const SECRET_KEYS = /token|refresh|access|key|secret|password|session/i;

function safeJson(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return raw;
  }
}

function state() {
  const sessions = (safeJson(localStorage.getItem("@auth.nh.sessions")) ?? {}) as Record<string, { access?: string; refresh?: string; apiKey?: string; expired?: boolean; me?: { username?: string } }>;
  const ml = getMlAccount();
  const cloud = getCloudState();
  return {
    href: location.href,
    platform: IS_DESKTOP ? "desktop" : "mobile",
    activeTab: getActiveTabId(),
    tabs: getTabs().map((t) => ({ id: t.id, resource: t.resource, path: t.path, account: t.account, pinned: !!t.pinned })),
    nh: {
      current: currentNhUserId(),
      clientHasSession: !!localStorage.getItem("@auth.v2.access_token"),
      clientHasKey: !!localStorage.getItem("@auth.v2.account_key"),
      accounts: Object.fromEntries(
        Object.entries(sessions).map(([id, s]) => [id, { user: s.me?.username ?? null, session: !!(s.access && s.refresh), key: !!s.apiKey, expired: !!s.expired }]),
      ),
    },
    moelibre: ml ? { id: ml.id, name: ml.display_name } : null,
    cloud: { enabled: cloud.enabled, status: cloud.status, peers: cloud.peers.length },
  };
}

async function evaluate(code: string): Promise<unknown> {
  const body = /\breturn\b/.test(code) ? code : `return (${code});`;
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...a: string[]) => () => Promise<unknown>;
  const result = await new AsyncFunction(body)();
  return JSON.parse(JSON.stringify(result ?? null, (k, v) => (typeof v === "string" && SECRET_KEYS.test(k) && v.length > 12 ? `<${v.length} символов>` : v)));
}

function navigate(path: string) {
  if (IS_DESKTOP) getActiveRouter().navigate(path);
  else location.hash = `#${path}`;
  return { ok: true, path };
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
  return !el.closest("[aria-hidden='true'], .is-hidden-tab");
}

const CLICKABLE = "button, a, [role=button], [role=menuitem], [role=tab], [role=radio], [role=option], input, select, textarea, label, [tabindex]";

function candidates(text?: string, selector?: string): HTMLElement[] {
  const base = Array.from(document.querySelectorAll<HTMLElement>(selector || CLICKABLE)).filter(visible);
  if (!text) return base;
  const q = text.trim().toLowerCase();
  const hits = base.filter((el) => (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLInputElement).placeholder || "").trim().toLowerCase().includes(q));
  // Самые узкие совпадения первыми (кнопка, а не её контейнер)
  return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
}

function describe(el: HTMLElement, i: number) {
  const r = el.getBoundingClientRect();
  return {
    i,
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 80),
    cls: el.className && typeof el.className === "string" ? el.className.slice(0, 60) : undefined,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
  };
}

function find({ text, selector, limit = 30 }: { text?: string; selector?: string; limit?: number }) {
  const list = candidates(text, selector);
  return { total: list.length, items: list.slice(0, limit).map(describe) };
}

function click({ selector, text, nth = 0, contextmenu }: { selector?: string; text?: string; nth?: number; contextmenu?: boolean }) {
  const el = candidates(text, selector)[nth];
  if (!el) throw new Error(`Не нашёл элемент (${text ? `текст «${text}»` : ""}${selector ? ` селектор ${selector}` : ""})`);
  el.scrollIntoView({ block: "nearest" });
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: contextmenu ? 2 : 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  if (contextmenu) el.dispatchEvent(new MouseEvent("contextmenu", opts));
  else el.click();
  return { clicked: describe(el, nth) };
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function key({ key: k, ctrl, shift, alt, target }: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; target?: Element | null }) {
  const el = target ?? document.activeElement ?? document.body;
  const init = { key: k, bubbles: true, cancelable: true, ctrlKey: !!ctrl, shiftKey: !!shift, altKey: !!alt };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return { key: k };
}

function type({ selector, text, enter, clear }: { selector?: string; text: string; enter?: boolean; clear?: boolean }) {
  const el = (selector ? document.querySelector(selector) : document.activeElement) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el || !("value" in el)) throw new Error("Нет поля для ввода");
  el.focus();
  setNativeValue(el, (clear ? "" : el.value) + text);
  if (enter) key({ key: "Enter", target: el });
  return { ok: true };
}

function text({ selector, max = 4000 }: { selector?: string; max?: number }) {
  const el = selector ? document.querySelector<HTMLElement>(selector) : document.body;
  if (!el) throw new Error(`Нет элемента ${selector}`);
  // Только видимое: скрытые вкладки ПК не в счёт
  const clone = el.innerText;
  return clone.replace(/\n{3,}/g, "\n\n").slice(0, max);
}

async function wait({ text: t, selector, timeoutMs = 10_000 }: { text?: string; selector?: string; timeoutMs?: number }) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (selector && Array.from(document.querySelectorAll(selector)).some(visible)) return { found: true };
    if (t && document.body.innerText.toLowerCase().includes(t.toLowerCase())) return { found: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { found: false };
}

function logsCmd({ level = "all", limit = 60, clear }: { level?: string; limit?: number; clear?: boolean }) {
  const list = (level === "error" ? logs.filter((l) => l.level === "error" || l.level === "warn") : logs).slice(-limit);
  const out = list.map((l) => `${new Date(l.t).toISOString().slice(11, 23)} ${l.level.toUpperCase()} ${l.text}`);
  if (clear) logs.length = 0;
  return out.join("\n") || "(пусто)";
}

type Args = Record<string, unknown>;
const commands: Record<string, (a: Args) => unknown> = {
  state: () => state(),
  eval: (a) => evaluate(String(a.code)),
  navigate: (a) => navigate(String(a.path)),
  find: (a) => find(a),
  click: (a) => click(a),
  type: (a) => type(a as { text: string }),
  key: (a) => key(a as { key: string }),
  text: (a) => text(a),
  wait: (a) => wait(a),
  logs: (a) => logsCmd(a),
  reload: () => {
    setTimeout(() => location.reload(), 50);
    return { ok: true };
  },
};

// ─── Подключение ──────────────────────────────────────────────────────────────

function connect() {
  let ws: WebSocket;
  try {
    ws = new WebSocket(URL);
  } catch {
    setTimeout(connect, RETRY_MS);
    return;
  }
  ws.onopen = () =>
    ws.send(JSON.stringify({ type: "hello", info: { tauri: "__TAURI_INTERNALS__" in window, platform: IS_DESKTOP ? "desktop" : "mobile", href: location.href, title: document.title } }));
  ws.onmessage = async (ev) => {
    let msg: { id: string; cmd: string; args?: Args };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const fn = commands[msg.cmd];
    try {
      if (!fn) throw new Error(`Неизвестная команда ${msg.cmd}`);
      const result = await fn(msg.args ?? {});
      ws.send(JSON.stringify({ id: msg.id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, error: e instanceof Error ? e.message : String(e) }));
    }
  };
  ws.onclose = () => setTimeout(connect, RETRY_MS);
  ws.onerror = () => ws.close();
}

export function startAppBridge(): void {
  connect();
}
