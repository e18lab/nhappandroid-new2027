/**
 * Настройки → Сервер: прогресс полного прохода каталога на nappi (`fullPass.service.ts` на сервере)
 * и машинного перевода названий (`titleTranslate.service.ts`) — чтобы следить с телефона. Только просмотр, обновляется каждые 10 с; управление — в админке nappi.
 */
import { useEffect, useState, type ReactNode } from "react";
import { getFullPass, getTitleTranslate, type FullPassInfo, type TitleTrStatus } from "../api/nappi";
import { useI18n } from "../i18n/I18nContext";
import { Icon, ListGroup, ListHint, Spinner } from "../ui";

const POLL_MS = 10_000;
const BUCKETS = ["list", "gallery", "tags"] as const;

export function ServerSettings() {
  const { t, resolved } = useI18n();
  const [info, setInfo] = useState<FullPassInfo | null>(null);
  /** undefined — ещё не загружено, null — сервер без перевода названий. */
  const [titleTr, setTitleTr] = useState<TitleTrStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = async () => {
      const [pass, tr] = await Promise.allSettled([getFullPass(), getTitleTranslate()]);
      if (!alive) return;
      if (pass.status === "fulfilled") {
        setInfo(pass.value);
        setError(null);
      } else setError(pass.reason instanceof Error ? pass.reason.message : String(pass.reason));
      if (tr.status === "fulfilled") setTitleTr(tr.value);
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

      {titleTr !== undefined && <TitleTranslateGroups s={titleTr} num={num} time={time} eta={eta} kv={kv} />}

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

/** Перевод названий: состояние, прогресс по БД, счётчики и последние переводы. */
function TitleTranslateGroups({
  s,
  num,
  time,
  eta,
  kv,
}: {
  s: TitleTrStatus | null;
  num: (n: number) => string;
  time: (iso: string | null) => string;
  eta: (min: number | null) => string;
  kv: (label: string, value: string, key?: string) => ReactNode;
}) {
  const { t } = useI18n();
  if (!s) return <ListHint>{t("settings.titleTr.notAvailable")}</ListHint>;

  const percent = s.totalBooks ? Math.floor((s.doneBooks / s.totalBooks) * 1000) / 10 : 0;
  const busy = s.state === "running" || (s.state === "live" && s.inFlight > 0);
  const tone = s.state === "error" ? "error" : s.state === "live" ? "latest" : "available";
  const icon = s.state === "error" ? "alert-circle" : s.state === "live" ? "check-circle" : "pause";

  return (
    <>
      <ListGroup title={t("settings.titleTr.title")}>
        <div className={`upd-status is-${tone}`}>
          {busy ? <Spinner size={18} /> : <Icon name={icon} size={18} />}
          <span>
            {t(`settings.titleTr.state.${s.state}`)}
            {s.totalBooks > 0 && ` · ${percent}%`}
          </span>
        </div>
        {s.totalBooks > 0 && (
          <>
            <div className="upd-bar">
              <span style={{ width: `${percent}%` }} />
            </div>
            {kv(t("settings.titleTr.progress", { done: num(s.doneBooks), total: num(s.totalBooks) }), "")}
            {s.perMin != null && kv(t("settings.titleTr.speed", { n: num(s.perMin) }), t("settings.server.eta", { time: eta(s.etaMinutes) }))}
          </>
        )}
        {kv(t("settings.titleTr.model"), s.model)}
        {kv(t("settings.titleTr.batch"), t("settings.titleTr.batchValue", { batch: s.batch, concurrency: s.concurrency }))}
        {kv(t("settings.titleTr.started"), time(s.startedAt))}
        {s.caughtUpAt && kv(t("settings.titleTr.caughtUp"), time(s.caughtUpAt))}
      </ListGroup>

      <ListGroup title={t("settings.titleTr.stats")}>
        {kv(t("settings.titleTr.translated"), num(s.translated))}
        {kv(t("settings.titleTr.reused"), num(s.reused))}
        {s.liveTranslated > 0 && kv(t("settings.titleTr.live"), num(s.liveTranslated))}
        {kv(t("settings.titleTr.failed"), num(s.failed))}
        {kv(t("settings.titleTr.requests"), num(s.requests))}
        {kv(t("settings.titleTr.tokens"), `${num(s.promptTokens)} / ${num(s.completionTokens)}`)}
        {kv(t("settings.titleTr.credit"), num(s.credit))}
        {kv(t("settings.server.errors"), num(s.errors))}
      </ListGroup>
      {s.lastError && (
        <ListHint>
          {t("settings.server.lastError")} ({time(s.lastErrorAt)}): {s.lastError}
        </ListHint>
      )}

      {s.recent.length > 0 && (
        <ListGroup title={t("settings.titleTr.recent")}>
          {s.recent.map((r) => (
            <div key={r.id} className="set-tr-row">
              <b>{r.title}</b>
              <span>
                #{r.id} · {r.source}
              </span>
            </div>
          ))}
        </ListGroup>
      )}
      <ListHint>{t("settings.titleTr.hint")}</ListHint>
    </>
  );
}
