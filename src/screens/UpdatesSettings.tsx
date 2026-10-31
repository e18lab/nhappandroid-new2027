/**
 * Настройки → Обновления: версии приложения и интерфейса, сервер обновлений, проверка, загрузка
 * (только изменившиеся файлы) и применение без переустановки (`lib/ota.ts`). Если новой версии нужна
 * новая нативная часть — подсказка поставить APK / установщик целиком.
 */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import {
  applyUpdate,
  checkUpdate,
  downloadUpdate,
  getOtaAuto,
  installFullUpdate,
  getOtaUrl,
  otaAvailable,
  refreshStatus,
  resetUpdate,
  setOtaAuto,
  setOtaUrl,
  useOta,
} from "../lib/ota";
import { Icon, ListField, ListGroup, ListHint, Spinner, SwitchRow } from "../ui";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function UpdatesSettings() {
  const { t } = useI18n();
  const ota = useOta();
  const [url, setUrl] = useState(getOtaUrl);
  const [auto, setAuto] = useState(getOtaAuto);

  useEffect(() => {
    void refreshStatus();
  }, []);

  if (!otaAvailable()) return <ListHint>{t("settings.updates.appOnly")}</ListHint>;

  const s = ota.status;
  const c = ota.check;
  const busy = ota.phase === "checking" || ota.phase === "downloading" || ota.phase === "fullDownloading";
  const statusText = (() => {
    switch (ota.phase) {
      case "checking":
        return t("settings.updates.checking");
      case "latest":
        return t("settings.updates.latest");
      case "available":
        return c ? t("settings.updates.available", { version: c.version, files: c.files, size: fmtBytes(c.bytes) }) : "";
      case "native":
        return c ? t("settings.updates.native", { version: c.version }) : "";
      case "downloading":
        return ota.progress ? t("settings.updates.downloading", { done: ota.progress.done, total: ota.progress.total }) : t("settings.updates.checking");
      case "ready":
        return t("settings.updates.ready", { version: s?.pending ?? c?.version ?? "" });
      case "full":
        return c?.native ? t("settings.updates.full", { version: c.native.version, size: fmtBytes(c.native.size) }) : "";
      case "fullDownloading":
        return ota.progress
          ? t("settings.updates.fullDownloading", { done: fmtBytes(ota.progress.done), total: fmtBytes(ota.progress.total) })
          : t("settings.updates.checking");
      case "fullPermission":
        return t("settings.updates.fullPermission");
      case "error":
        return t("settings.updates.error", { error: ota.error ?? "" });
      default:
        return "";
    }
  })();

  return (
    <>
      <ListGroup title={t("settings.updates.versions")}>
        <div className="set-kv">
          <span>{t("settings.updates.app")}</span>
          <b>{s?.nativeVersion ?? "…"}</b>
        </div>
        <div className="set-kv">
          <span>{t("settings.updates.ui")}</span>
          <b>{s?.uiVersion ?? "…"}</b>
        </div>
      </ListGroup>

      <ListGroup title={t("settings.updates.title")}>
        {statusText && (
          <div className={`upd-status is-${ota.phase}`}>
            {busy ? <Spinner size={18} /> : <Icon name={ota.phase === "error" || ota.phase === "native" ? "alert-circle" : ota.phase === "latest" ? "check-circle" : "download"} size={18} />}
            <span>{statusText}</span>
          </div>
        )}
        {(ota.phase === "downloading" || ota.phase === "fullDownloading") && ota.progress && (
          <div className="upd-bar">
            <span style={{ width: `${(ota.progress.done / Math.max(1, ota.progress.total)) * 100}%` }} />
          </div>
        )}
        <div className="upd-actions">
          {ota.phase === "full" || ota.phase === "fullPermission" ? (
            <button type="button" className="ax-btn ax-btn-primary" onClick={() => void installFullUpdate()}>
              <Icon name="download" size={18} />
              {ota.phase === "fullPermission" ? t("settings.updates.allowInstall") : t("settings.updates.installFull")}
            </button>
          ) : ota.phase === "ready" ? (
            <button type="button" className="ax-btn ax-btn-primary" onClick={() => void applyUpdate()}>
              <Icon name="refresh-cw" size={18} />
              {t("settings.updates.apply")}
            </button>
          ) : ota.phase === "available" ? (
            <button type="button" className="ax-btn ax-btn-primary" onClick={() => void downloadUpdate()}>
              <Icon name="download" size={18} />
              {t("settings.updates.download")}
            </button>
          ) : (
            <button type="button" className="ax-btn ax-btn-ghost" disabled={busy || !url} onClick={() => void checkUpdate()}>
              <Icon name="search" size={18} />
              {t("settings.updates.check")}
            </button>
          )}
        </div>
      </ListGroup>

      <ListGroup title={t("settings.updates.server")}>
        <ListField
          value={url}
          placeholder="http://192.168.1.10:8787"
          onChange={(v) => {
            setUrl(v);
            setOtaUrl(v);
          }}
        />
        <SwitchRow
          title={t("settings.updates.auto")}
          description={t("settings.updates.autoSub")}
          value={auto}
          onChange={(v) => {
            setAuto(v);
            setOtaAuto(v);
          }}
        />
      </ListGroup>
      <ListHint>{t("settings.updates.hint")}</ListHint>

      {s && s.uiVersion !== s.nativeVersion && (
        <ListGroup>
          <button type="button" className="set-row set-row-action" onClick={() => void resetUpdate()}>
            <Icon name="rotate-ccw" size={20} />
            <span className="set-row-title">{t("settings.updates.reset")}</span>
          </button>
        </ListGroup>
      )}
    </>
  );
}
