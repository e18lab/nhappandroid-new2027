#!/usr/bin/env node
/**
 * MCP-мост для отладки ПК-версии MoeLibre (только `tauri dev` / `npm run dev`).
 *
 * Как устроено: этот процесс — MCP-сервер по stdio (его запускает Claude Code, см. `.mcp.json`) и заодно
 * WebSocket-сервер на 127.0.0.1:47321. Приложение в режиме разработки само подключается к нему
 * (`src/dev/appBridge.ts`) и выполняет команды: прочитать состояние, выполнить JS, перейти, нажать, ввести текст.
 * Снимок экрана — окно «MoeLibre» целиком средствами Windows (PrintWindow), без участия страницы.
 *
 * Слушает только localhost. Токены и ключи в ответы не попадают (только «есть / нет»).
 * Капчи мост не проходит и не обходит — их проходит человек.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { z } from "zod";

const PORT = Number(process.env.MOELIBRE_BRIDGE_PORT || 47321);
const CALL_TIMEOUT_MS = 30_000;

// ─── Мост к приложению ────────────────────────────────────────────────────────

/** @type {Map<string, {ws: import("ws").WebSocket, info: Record<string, unknown>, at: number}>} */
const clients = new Map();
let seq = 0;
const pending = new Map();

const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
wss.on("error", (e) => console.error(`[app-mcp] ws: ${e.message}`));
wss.on("connection", (ws, req) => {
  const origin = req.headers.origin ?? "";
  // Только страницы приложения на этой машине
  if (origin && !/^(https?:\/\/(127\.0\.0\.1|localhost|tauri\.localhost)(:\d+)?|tauri:\/\/localhost)$/.test(origin)) {
    ws.close(1008, "origin");
    return;
  }
  const id = `c${++seq}`;
  clients.set(id, { ws, info: {}, at: Date.now() });
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "hello") {
      clients.get(id).info = msg.info ?? {};
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  });
  ws.on("close", () => clients.delete(id));
});

/** Окно приложения: указанное, иначе последнее подключившееся окно Tauri, иначе последнее любое. */
function pickClient(client) {
  if (client) {
    const c = clients.get(client);
    if (!c) throw new Error(`Нет подключения ${client}. Подключены: ${[...clients.keys()].join(", ") || "никого"}`);
    return c;
  }
  const all = [...clients.values()].sort((a, b) => b.at - a.at);
  const c = all.find((x) => x.info.tauri) ?? all[0];
  if (!c) throw new Error("Приложение не подключено. Запусти `npm run tauri dev` (или открой dev-сервер) — мост подключается сам в режиме разработки.");
  return c;
}

function call(client, cmd, args = {}) {
  const c = pickClient(client);
  const id = `r${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Приложение не ответило за ${CALL_TIMEOUT_MS / 1000} с`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    c.ws.send(JSON.stringify({ id, cmd, args }));
  });
}

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (e) => ({ content: [{ type: "text", text: `Ошибка: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
const wrap = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    return fail(e);
  }
};

// ─── Снимок окна (Windows) ────────────────────────────────────────────────────

const SHOT_PS = String.raw`
param([string]$Title, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq $Title } | Select-Object -First 1
if (-not $p) { Write-Error "window not found"; exit 2 }
$r = New-Object W+RECT
[W]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
[W]::PrintWindow($p.MainWindowHandle, $dc, 2) | Out-Null
$g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
`;

async function screenshot(title) {
  const out = join(tmpdir(), `moelibre-shot-${Date.now()}.png`);
  const script = join(tmpdir(), "moelibre-shot.ps1");
  await import("node:fs/promises").then((fs) => fs.writeFile(script, SHOT_PS, "utf8"));
  await new Promise((resolve, reject) =>
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Title", title, "-Out", out], { timeout: 20_000 }, (err, _o, se) =>
      err ? reject(new Error(se?.trim() || err.message)) : resolve(),
    ),
  );
  const data = await readFile(out);
  await unlink(out).catch(() => {});
  return data.toString("base64");
}

// ─── Инструменты ──────────────────────────────────────────────────────────────

const server = new McpServer({ name: "moelibre-app", version: "1.0.0" });
const clientArg = { client: z.string().optional().describe("id подключения из app_clients; по умолчанию — окно Tauri") };

server.tool("app_clients", "Подключённые окна приложения (Tauri и браузер dev-сервера): id, платформа, адрес.", {}, wrap(async () =>
  text([...clients.entries()].map(([id, c]) => ({ id, ...c.info, connectedAgoSec: Math.round((Date.now() - c.at) / 1000) }))),
));

server.tool(
  "app_state",
  "Состояние приложения: адрес, вкладки (аккаунт, адрес), выбранная, текущий аккаунт nhentai, входы аккаунтов на устройстве (только есть/нет сессии и ключа, без секретов), MoeLibre ID, облако.",
  clientArg,
  wrap(async ({ client }) => text(await call(client, "state"))),
);

server.tool(
  "app_eval",
  "Выполнить JavaScript в окне приложения (async; последнее выражение или return — результат, сериализуется в JSON). Для отладки; секреты не выводить.",
  { code: z.string(), ...clientArg },
  wrap(async ({ code, client }) => text(await call(client, "eval", { code }))),
);

server.tool(
  "app_navigate",
  "Перейти на адрес приложения в выбранной вкладке (например `/`, `/book/123`, `/accounts/nhentai`, `/settings`).",
  { path: z.string(), ...clientArg },
  wrap(async ({ path, client }) => text(await call(client, "navigate", { path }))),
);

server.tool(
  "app_find",
  "Найти видимые элементы по тексту и / или CSS-селектору: тег, текст, роль, координаты. Для выбора, что нажать.",
  { text: z.string().optional(), selector: z.string().optional(), limit: z.number().optional(), ...clientArg },
  wrap(async ({ client, ...args }) => text(await call(client, "find", args))),
);

server.tool(
  "app_click",
  "Нажать элемент: по CSS-селектору, по видимому тексту (кнопки, ссылки, пункты) или по индексу из app_find. `nth` — какой по счёту из найденных.",
  { selector: z.string().optional(), text: z.string().optional(), nth: z.number().optional(), contextmenu: z.boolean().optional(), ...clientArg },
  wrap(async ({ client, ...args }) => text(await call(client, "click", args))),
);

server.tool(
  "app_type",
  "Ввести текст в поле (CSS-селектор; без него — поле в фокусе). `enter` — нажать Enter после ввода, `clear` — очистить сначала.",
  { selector: z.string().optional(), text: z.string(), enter: z.boolean().optional(), clear: z.boolean().optional(), ...clientArg },
  wrap(async ({ client, ...args }) => text(await call(client, "type", args))),
);

server.tool(
  "app_key",
  "Нажать клавишу в окне (Escape, Enter, ArrowDown, k с ctrl и т. п.).",
  { key: z.string(), ctrl: z.boolean().optional(), shift: z.boolean().optional(), alt: z.boolean().optional(), ...clientArg },
  wrap(async ({ client, ...args }) => text(await call(client, "key", args))),
);

server.tool(
  "app_text",
  "Видимый текст страницы или элемента (CSS-селектор), обрезанный до `max` символов.",
  { selector: z.string().optional(), max: z.number().optional(), ...clientArg },
  wrap(async ({ client, ...args }) => text(await call(client, "text", args))),
);

server.tool(
  "app_logs",
  "Последние сообщения консоли приложения (ошибки, предупреждения, логи) и необработанные исключения.",
  { level: z.enum(["all", "error"]).optional(), limit: z.number().optional(), clear: z.boolean().optional(), ...clientArg },
  wrap(async ({ client, ...args }) => text(await call(client, "logs", args))),
);

server.tool("app_reload", "Перезагрузить страницу приложения (как F5).", clientArg, wrap(async ({ client }) => {
  await call(client, "reload").catch(() => undefined);
  return text("перезагружается — подключится заново через пару секунд");
}));

server.tool(
  "app_wait",
  "Подождать, пока на странице появится текст или элемент (до `timeoutMs`, по умолчанию 10 с).",
  { text: z.string().optional(), selector: z.string().optional(), timeoutMs: z.number().optional(), ...clientArg },
  wrap(async ({ client, ...args }) => text(await call(client, "wait", args))),
);

server.tool(
  "app_screenshot",
  "Снимок окна приложения целиком (Windows, PrintWindow). `title` — заголовок окна, по умолчанию MoeLibre.",
  { title: z.string().optional() },
  wrap(async ({ title }) => ({ content: [{ type: "image", data: await screenshot(title || "MoeLibre"), mimeType: "image/png" }] })),
);

await server.connect(new StdioServerTransport());
console.error(`[app-mcp] готов: MCP по stdio, мост ws://127.0.0.1:${PORT}`);
