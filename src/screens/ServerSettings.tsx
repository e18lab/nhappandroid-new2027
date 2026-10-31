/**
 * Настройки → Сервер: прогресс полного прохода каталога на nappi (`fullPass.service.ts` на сервере) —
 * чтобы следить с телефона. Только просмотр, обновляется каждые 10 с; управление — в админке nappi.
 */
import { useEffect, useState } from "react";
import { getFullPass, type FullPassInfo } from "../api/nappi";
import { useI18n } from "../i18n/I18nContext";
import { Icon, ListGroup, ListHint, Spinner } from "../ui";

const POLL_MS = 10_000;
const BUCKETS = ["list", "gallery", "tags"] as const;

export function ServerSettings() {
  const { t, resolved } = useI18n();
  const [info, setInfo] = useState<FullPassInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = async () => {
      try {
        const next = await getFullPass();
        if (!alive) return;
        setInfo(next);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      if (alive) timer = window.setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  const num = (n: number) => n.toLocaleString(resolved);
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(resolved, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const eta = (min: number | null) =>
    min == null ? "—" : min >= 60 ? t("settings.server.hours", { h: Math.floor(min / 60), m: min % 60 }) : t("settings.server.minutes", { m: min });

  if (!info) {
    return error ? (
      <ListHint>{t("settings.server.loadError", { error })}</ListHint>
    ) : (
      <div className="upd-status">
        <Spinner size={18} />
      </div>
    );
  }

  const s = info.status;
  const total = s.fromPage ? s.fromPage - s.toPage + 1 : 0;
  const done = total ? Math.min(total, s.fromPage - s.nextPage) : 0;
  const percent = total ? Math.round((done / total) * 1000) / 10 : 0;
  const running = s.state === "running";
  const kv = (label: string, value: string, key?: string) => (
    <div key={key} className="set-kv">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );

  return (
    <>
      <ListGroup title={t("settings.server.title")}>
        <div className={`upd-status is-${s.state === "error" ? "error" : s.state === "done" ? "latest" : "available"}`}>
          {running ? <Spinner size={18} /> : <Icon name={s.state === "error" ? "alert-circle" : s.state === "done" ? "check-circle" : "pause"} size={18} />}
          <span>
            {t(`settings.server.state.${s.state}`)}
            {total > 0 && ` · ${percent}%`}
          </span>
        </div>
        {total > 0 && (
          <>
            <div className="upd-bar">
              <span style={{ width: `${percent}%` }} />
            </div>
            {kv(t("settings.server.page", { page: Math.max(s.nextPage, s.toPage), from: s.fromPage, to: s.toPage }), "")}
            {running && kv(t("settings.server.speed", { n: s.pagesPerMin ?? "—" }), t("settings.server.eta", { time: eta(s.etaMinutes) }))}
            {kv(t("settings.server.started"), time(s.startedAt))}
          </>
        )}
      </ListGroup>

      {total > 0 && (
        <ListGroup title={t("settings.server.stats")}>
          {kv(t("settings.server.seen"), num(s.cardsSeen))}
          {kv(t("settings.server.inserted"), num(s.inserted))}
          {kv(t("settings.server.updated"), num(s.updated))}
          {kv(t("settings.server.unchanged"), num(s.unchanged))}
          {kv(t("settings.server.tags"), num(s.tagsResolved))}
          {kv(t("settings.server.full"), t("settings.server.queue", { done: num(s.fullFetched), total: num(s.fullQueued), queue: num(s.fullQueueSize) }))}
          {kv(t("settings.server.missing"), num(s.fullMissing))}
          {kv(t("settings.server.errors"), num(s.errors))}
        </ListGroup>
      )}
      {s.lastError && (
        <ListHint>
          {t("settings.server.lastError")} ({time(s.lastErrorAt)}): {s.lastError}
        </ListHint>
      )}

      <ListGroup title={t("settings.server.library")}>
        {kv(t("settings.server.books"), num(info.booksInLib))}
        {kv(t("settings.server.maxId"), String(info.maxBookId))}
      </ListGroup>

      <ListGroup title={t("settings.server.limits")}>
        {kv(t("settings.server.apiKey"), info.limiter.apiKey ? t("settings.server.yes") : t("settings.server.no"))}
        {BUCKETS.map((name) => {
          const b = info.limiter.buckets[name];
          if (!b) return null;
          const row = t("settings.server.bucketRow", { sent: num(b.sent), limited: num(b.limited) });
          return kv(
            `${t(`settings.server.bucket.${name}`)} · ${b.rpm}/min`,
            b.pausedForMs > 0 ? `${row} · ${t("settings.server.paused", { s: Math.ceil(b.pausedForMs / 1000) })}` : row,
            name,
          );
        })}
      </ListGroup>

      <ListHint>
        {t("settings.server.hint")} {t("settings.server.updatedAt", { time: time(s.updatedAt) })}
        {error && ` · ${t("settings.server.loadError", { error })}`}
      </ListHint>
    </>
  );
}
