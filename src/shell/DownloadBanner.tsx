/**
 * Плашка идущей загрузки на всех экранах (см. `DownloadBanner`). Уведомления «Сохранено» /
 * «Отменено» / «Ошибка» тоже отсюда: оболочка смонтирована всегда, даже если экран книги уже закрыт.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { thumbSources } from "../api/media";
import { SmartImage } from "../components/SmartImage";
import { useDownloadState } from "../lib/downloads";
import { IS_DESKTOP } from "../lib/platform";
import { Icon, useToast } from "../ui";

/** Уведомление об итоге загрузки; рендерится и в читалке, где полосы нет. */
export function DownloadNotifier() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { lastResult } = useDownloadState();
  const shown = useRef(lastResult?.at ?? 0);

  useEffect(() => {
    if (!lastResult || lastResult.at <= shown.current) return;
    shown.current = lastResult.at;
    if (lastResult.result === "saved") showToast({ type: "success", title: t("downloads.saved") });
    else if (lastResult.result === "canceled") showToast({ title: t("downloads.canceled") });
    else showToast({ type: "error", title: t("downloads.failed"), message: lastResult.message });
  }, [lastResult, showToast, t]);

  return null;
}

const SHOW_MS = 3500;

/**
 * Идёт загрузка — ненавязчиво и поверх экрана (в поток не встаёт):
 *  - началась — сверху выезжает плашка «Загрузка началась» с обложкой, названием и прогрессом,
 *    через 3,5 с сама уезжает (можно смахнуть или закрыть крестиком раньше);
 *  - дальше прогресс — тонкая красная линия у самого верха окна, ничего не закрывает;
 *  - итог («Сохранено» / ошибка) — уведомлением `DownloadNotifier`.
 * Нажатие на плашку открывает «Загруженное»; на «Загруженном» — только линия.
 * Плашка — под шапкой (на ПК — под шапкой окна у правого края, там же линия), чтобы не перекрывать вкладки и разделы.
 */
export function DownloadBanner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dl = useDownloadState();
  const [shown, setShown] = useState<number | null>(null);
  const seen = useRef<number | null>(null);

  // Новая загрузка — показать плашку и спрятать по таймеру
  useEffect(() => {
    if (!dl.active || dl.bookId == null || seen.current === dl.bookId) return;
    seen.current = dl.bookId;
    setShown(dl.bookId);
    const id = window.setTimeout(() => setShown(null), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [dl.active, dl.bookId]);
  useEffect(() => {
    if (!dl.active) {
      seen.current = null;
      setShown(null);
    }
  }, [dl.active]);

  // Плашка — под шапкой, чтобы её не перекрывать. ПК: шапка окна (вкладки, разделы, адрес), плашка у правого
  // края, как загрузки в браузере; там же линия. Телефон: шапка экрана и полоса разделов под ней.
  const [anchor, setAnchor] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!dl.active) return;
    if (IS_DESKTOP) {
      const bar = document.querySelector<HTMLElement>(".ax-desk > .dk-titlebar");
      if (!bar) return;
      const measure = () => setAnchor(Math.round(bar.getBoundingClientRect().bottom));
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(bar);
      return () => ro.disconnect();
    }
    if (shown == null) return;
    const layer = document.querySelector<HTMLElement>(".ax-layer.is-top");
    const head = layer?.querySelector<HTMLElement>(".ax-header")?.getBoundingClientRect().bottom ?? 0;
    const tabs = layer?.querySelector<HTMLElement>(".ax-tabs")?.getBoundingClientRect();
    setAnchor(Math.round(tabs && tabs.top < head + 60 ? Math.max(head, tabs.bottom) : head));
  }, [dl.active, shown]);

  if (!dl.active) return null;
  const pct = Math.round(Math.max(0, Math.min(1, dl.progress)) * 100);
  const pill = shown != null && pathname !== "/downloaded";

  const style = anchor ? ({ "--dl-top": `${anchor}px` } as CSSProperties) : undefined;
  return createPortal(
    <div className={IS_DESKTOP ? "dl-host is-desk" : "dl-host"} style={style}>
      <div className="dl-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("downloads.downloading")}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {pill && (
        <div className="dl-pill" role="status">
          <button type="button" className="dl-pill-main" onClick={() => navigate("/downloaded")}>
            <span className="dl-pill-cover">
              <SmartImage sources={thumbSources(dl.cover ?? undefined)} />
            </span>
            <span className="dl-pill-text">
              <span>
                {t("downloads.started")} · {pct}%
              </span>
              <b>{dl.title || t("downloads.downloading")}</b>
            </span>
          </button>
          <button type="button" className="dl-pill-close" onClick={() => setShown(null)} aria-label={t("common.close")}>
            <Icon name="x" size={16} />
          </button>
          <span className="dl-pill-track">
            <span style={{ width: `${pct}%` }} />
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}
