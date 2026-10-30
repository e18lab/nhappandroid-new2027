/**
 * Полоса загрузки под шапкой на всех экранах — перенос `components/DownloadProgressBanner.tsx`.
 * Нажатие открывает «Загруженное» (на нём самом полоса не нажимается). Уведомления «Сохранено» /
 * «Отменено» / «Ошибка» тоже отсюда: оболочка смонтирована всегда, даже если экран книги уже закрыт.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import { useDownloadState } from "../lib/downloads";
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

export function DownloadBanner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dl = useDownloadState();
  if (!dl.active) return null;
  const pct = Math.round(Math.max(0, Math.min(1, dl.progress)) * 100);
  const here = pathname === "/downloaded";
  return (
    <button type="button" className="dl-banner" disabled={here} onClick={() => navigate("/downloaded")}>
      <span className="dl-banner-row">
        <Icon name="download" size={16} />
        <span className="dl-banner-title">{dl.title || t("downloads.downloading")}</span>
        <span className="dl-banner-pct">{pct}%</span>
      </span>
      <span className="dl-banner-track">
        <span style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}
