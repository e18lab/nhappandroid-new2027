/**
 * Кнопка «Обновить» в шапке главной (телефон) и в заголовке окна (ПК): появляется, когда на сервере
 * есть новая версия интерфейса или она уже скачана. Нажатие — докачать (если надо) и применить
 * (страница перезагружается на новой версии). Если вышла новая сборка приложения целиком —
 * та же кнопка качает и ставит APK / установщик. Во время загрузки — процент.
 */
import { useI18n } from "../i18n/I18nContext";
import { installUpdate, useOta } from "../lib/ota";
import { Icon, Spinner } from "../ui";

export function UpdateButton() {
  const { t } = useI18n();
  const { phase, progress, check, status } = useOta();
  if (!["available", "downloading", "ready", "full", "fullDownloading", "fullPermission"].includes(phase)) return null;
  const full = phase.startsWith("full");
  const loading = phase === "downloading" || phase === "fullDownloading";
  const version = full ? (check?.native?.version ?? "") : (status?.pending ?? check?.version ?? "");
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <button
      type="button"
      className={`upd-chip is-${loading ? "downloading" : phase}`}
      title={t("settings.updates.ready", { version })}
      disabled={loading}
      onClick={() => void installUpdate()}
    >
      {loading ? <Spinner size={14} /> : <Icon name="download" size={16} />}
      <span>{loading ? `${pct}%` : phase === "fullPermission" ? t("settings.updates.allowInstall") : t("settings.updates.install")}</span>
    </button>
  );
}
