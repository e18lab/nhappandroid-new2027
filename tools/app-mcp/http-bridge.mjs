#!/usr/bin/env node
/**
 * Тот же мост к приложению, что и MCP-сервер, но с входом по HTTP — когда MCP в сессии не подключён.
 *   node tools/app-mcp/http-bridge.mjs
 *   curl -s localhost:47322/cmd -d '{"cmd":"state"}'
 * Слушает только 127.0.0.1. Команды — как у src/dev/appBridge.ts (state, eval, navigate, find, click, type, key, text, wait, logs, reload).
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const WS_PORT = Number(process.env.MOELIBRE_BRIDGE_PORT || 47321);
const HTTP_PORT = WS_PORT + 1;

const clients = new Map();
const pending = new Map();
let seq = 0;

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
wss.on("connection", (ws, req) => {
  const origin = req.headers.origin ?? "";
  if (origin && !/^(https?:\/\/(127\.0\.0\.1|localhost|tauri\.localhost)(:\d+)?|tauri:\/\/localhost)$/.test(origin)) return ws.close(1008, "origin");
  const id = `c${++seq}`;
  clients.set(id, { ws, info: {}, at: Date.now() });
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "hello") return void (clients.get(id).info = msg.info ?? {});
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
  });
  ws.on("close", () => clients.delete(id));
});

function call(client, cmd, args) {
  const all = [...clients.entries()].sort((a, b) => b[1].at - a[1].at);
  const hit = client ? all.find(([id]) => id === client) : (all.find(([, c]) => c.info.tauri) ?? all[0]);
  if (!hit) return Promise.reject(new Error("Приложение не подключено"));
  const id = `r${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (pending.delete(id), reject(new Error("timeout"))), Number(args?.timeoutMs) || 240_000);
    pending.set(id, { resolve, reject, timer });
    hit[1].ws.send(JSON.stringify({ id, cmd, args: args ?? {} }));
  });
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    try {
      if (req.url === "/clients") return res.end(JSON.stringify([...clients.entries()].map(([id, c]) => ({ id, ...c.info }))));
      const { cmd, args, client } = JSON.parse(body || "{}");
      res.end(JSON.stringify({ result: await call(client, cmd, args) }, null, 2));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });
}).listen(HTTP_PORT, "127.0.0.1", () => console.log(`bridge ws:${WS_PORT} http:${HTTP_PORT}`));
