/**
 * Облако MoeLibre в профиле: карточка в `/mlid` и страницы
 *  - `/mlid/cloud/setup` — включение: что попадёт в облако (части с переключателями) и предупреждение;
 *  - `/mlid/cloud/import` — перенос из старого облака NHApp (nappi) для каждого привязанного аккаунта nhentai;
 *  - `/mlid/cloud/data` — что синхронизируется: части облака, их размер, переключатели для этого устройства;
 *  - `/mlid/cloud/devices` — устройства на связи;
 *  - `/mlid/cloud/manage` — копия файлом, перенос заново, выключить, удалить облако.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nContext";
import {
  allKnownParts,
  decideImport,
  deviceParts,
  disableCloud,
  enableCloud,
  exportCloud,
  fetchCloudInfo,
  fetchNappiSnapshot,
  importFromNappi,
  isPartActive,
  isPartOn,
  localPartSummary,
  setPartOn,
  summarizeSnapshot,
  syncNow,
  useCloudState,
  type CloudInfo,
  type CloudState,
} from "../lib/cloudSync";
import { getDeviceId } from "../lib/device";
import { MlError, useMl } from "../lib/mlid";
import { useNhLink } from "../lib/mlNhentai";
import { useNhAccounts } from "../lib/nhAccounts";
import { createVaultKey, isVaultKeyLike, resetVaultKey, unlockVault, useVaultSecret } from "../lib/vault";
import { useMe } from "../lib/session";
import { timeAgo } from "../lib/timeAgo";
import { Icon, Spinner, useToast } from "../ui";

type IconName = Parameters<typeof Icon>[0]["name"];
type T = ReturnType<typeof useI18n>["t"];

const ML_RED = { "--c": "#ff4040" } as CSSProperties;

/** Цвет точки статуса: зелёный — быстрый ответ, жёлтый — медленно или подключаемся, серый — выключено. */
function dotColor(cloud: CloudState): string {
  if (!cloud.enabled) return "#6b7280";
  if (cloud.status === "online") return cloud.pingMs == null || cloud.pingMs < 120 ? "#22c55e" : cloud.pingMs < 350 ? "#eab308" : "#ef4444";
  return "#eab308";
}

/** Название, описание и значок части облака. */
function usePartLabel() {
  const { t } = useI18n();
  const nh = useNhLink();
  const nhMe = useMe();
  return (part: string): { title: string; sub: string; icon: IconName; color: string } => {
    if (part === "app") return { title: t("mlcloud.part.app"), sub: t("mlcloud.part.appSub"), icon: "settings", color: "#ff4040" };
    if (part === "app.pc") return { title: t("mlcloud.part.pc"), sub: t("mlcloud.part.layoutSub"), icon: "layout", color: "#7c6cf2" };
    if (part === "app.mobile") return { title: t("mlcloud.part.mobile"), sub: t("mlcloud.part.layoutSub"), icon: "smartphone", color: "#7c6cf2" };
    if (part === "tabs") return { title: t("mlcloud.part.tabs"), sub: t("mlcloud.part.tabsSub"), icon: "copy", color: "#3fa7e0" };
    if (part === "res:nhentai") return { title: t("mlcloud.part.res", { name: "nhentai" }), sub: t("mlcloud.part.resSub"), icon: "tag", color: "#ed2553" };
    const m = /^acc:nhentai:(\d+)$/.exec(part);
    if (m) {
      const id = Number(m[1]);
      const name = nh.accounts?.find((a) => a.id === id)?.username ?? (nhMe?.id === id ? nhMe.username : `#${id}`);
      return { title: t("mlcloud.part.acc", { name }), sub: t("mlcloud.part.accSub"), icon: "bookmark", color: "#ed2553" };
    }
    return { title: part, sub: "", icon: "database", color: "#78909c" };
  };
}

function errText(t: T, e: unknown): string {
  const code = e instanceof MlError ? e.code : String((e as Error)?.message ?? e);
  const key = `mlid.err.${code}`;
  const text = t(key);
  return text === key ? t("mlid.err.generic", { code }) : text;
}

/** Аккаунты nhentai, по которым ещё не решили, переносить ли старое облако. */
function useImportsPending(info: CloudInfo | null): number[] {
  const nh = useNhLink();
  if (!info || !nh.accounts) return [];
  const decided = new Set(info.imports.filter((i) => i.source === "nappi").map((i) => i.external_id));
  return nh.accounts.map((a) => a.id).filter((id) => !decided.has(String(id)));
}

function useCloudInfo(deps: unknown[] = []): [CloudInfo | null, () => void] {
  const [info, setInfo] = useState<CloudInfo | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchCloudInfo().then(
      (i) => alive && setInfo(i),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [tick, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [info, () => setTick((n) => n + 1)];
}

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ─── Карточка в профиле ───────────────────────────────────────────────────────

export function MlCloudCard() {
  const { t, resolved } = useI18n();
  const navigate = useNavigate();
  const cloud = useCloudState();
  const [info] = useCloudInfo([cloud.enabled]);
  const pendingImports = useImportsPending(cloud.enabled ? info : null);
  const hasSecret = useVaultSecret();

  if (cloud.enabled === null) {
    return (
      <div className="ml-cloud">
        <div className="ml-cloud-head">
          <span className="ml-cloud-icon">
            <Icon name="cloud" size={22} />
          </span>
          <span className="ml-cloud-text">
            <b>{cloud.status === "retry" ? t("mlcloud.retry") : t("mlcloud.connecting")}</b>
          </span>
          <Spinner size={18} />
        </div>
      </div>
    );
  }

  if (!cloud.enabled) {
    return (
      <div className="ml-cloud is-disabled">
        <div className="ml-cloud-head">
          <span className="ml-cloud-icon">
            <Icon name="cloud" size={22} />
            <i style={{ background: dotColor(cloud) }} />
          </span>
          <span className="ml-cloud-text">
            <b>{t("mlcloud.off")}</b>
            <span className="is-wrap">{t("mlcloud.offSub")}</span>
          </span>
          <button type="button" className="ml-btn is-primary" onClick={() => navigate("/mlid/cloud/setup")}>
            {t("mlcloud.enable")}
          </button>
        </div>
      </div>
    );
  }

  // Облако включено, а на этом устройстве ключ защиты не введён — данные не синхронизируются
  if (cloud.granted === false || (cloud.granted && !hasSecret)) {
    return (
      <div className="ml-cloud is-disabled">
        <div className="ml-cloud-head">
          <span className="ml-cloud-icon">
            <Icon name="lock" size={22} />
          </span>
          <span className="ml-cloud-text">
            <b>{t("mlcloud.vault.locked")}</b>
            <span className="is-wrap">{t("mlcloud.vault.lockedSub")}</span>
          </span>
          <button type="button" className="ml-btn is-primary" onClick={() => navigate("/mlid/cloud/setup")}>
            {t("mlcloud.vault.unlock")}
          </button>
        </div>
      </div>
    );
  }

  const busy = cloud.status !== "online";
  const last = cloud.lastSync;
  const lastFrom = last && (last.fromDeviceId === getDeviceId() ? t("mlid.thisDevice") : cloud.peers.find((p) => p.device_id === last.fromDeviceId)?.device_name);
  const onCount = deviceParts().filter(isPartOn).length;

  return (
    <div className={`ml-cloud is-${cloud.status}`}>
      <div className="ml-cloud-head">
        <span className="ml-cloud-icon">
          <Icon name="cloud" size={22} />
          <i style={{ background: dotColor(cloud) }} />
        </span>
        <span className="ml-cloud-text">
          <b>
            {cloud.status === "online"
              ? cloud.pingMs != null
                ? t("mlcloud.onlinePing", { ms: Math.round(cloud.pingMs) })
                : t("mlcloud.online")
              : cloud.status === "retry"
                ? t("mlcloud.retry")
                : t("mlcloud.connecting")}
          </b>
          <span>{last ? t("mlcloud.lastSync", { time: timeAgo(last.at, resolved), from: lastFrom || t("mlcloud.otherDevice") }) : t("mlcloud.onSub")}</span>
        </span>
        <button type="button" className="ml-btn is-soft" style={ML_RED} onClick={syncNow} disabled={busy}>
          {busy ? <Spinner size={14} /> : t("mlcloud.syncNow")}
        </button>
      </div>
      {pendingImports.length > 0 && (
        <button type="button" className="ml-cloud-banner" onClick={() => navigate("/mlid/cloud/import")}>
          <Icon name="download" size={18} />
          <span>{t("mlcloud.importBanner")}</span>
          <Icon name="chevron-right" size={18} />
        </button>
      )}
      {cloud.error && <p className="ml-cloud-last is-error">{errText(t, new MlError(cloud.error))}</p>}
      <div className="ml-cloud-links is-3">
        <CloudLink icon="database" title={t("mlcloud.data")} sub={t("mlcloud.dataSub", { n: onCount, total: deviceParts().length })} to="/mlid/cloud/data" />
        <CloudLink icon="smartphone" title={t("mlcloud.devices")} sub={t("mlcloud.devicesSub", { n: cloud.peers.length })} to="/mlid/cloud/devices" />
        <CloudLink icon="sliders" title={t("mlcloud.manage")} sub={t("mlcloud.manageSub")} to="/mlid/cloud/manage" />
      </div>
    </div>
  );
}

function CloudLink({ icon, title, sub, to }: { icon: IconName; title: string; sub: string; to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="ml-cloud-link" onClick={() => navigate(to)}>
      <Icon name={icon} size={18} />
      <span>
        <b>{title}</b>
        <span>{sub}</span>
      </span>
      <Icon name="chevron-right" size={18} />
    </button>
  );
}

// ─── Строка части с переключателем ────────────────────────────────────────────

function PartRow({ part, server, children }: { part: string; server?: CloudInfo["parts"][number]; children?: ReactNode }) {
  const { t, resolved } = useI18n();
  const label = usePartLabel()(part);
  const on = isPartOn(part);
  const activeHere = isPartActive(part);
  const local = activeHere ? localPartSummary(part) : null;
  const bits: string[] = [];
  if (local?.favorites != null) bits.push(t("mlcloud.nFav", { n: local.favorites }));
  if (local?.history != null) bits.push(t("mlcloud.nHist", { n: local.history }));
  if (local?.searches != null) bits.push(t("mlcloud.nSearch", { n: local.searches }));
  if (local && !bits.length) bits.push(t("mlcloud.nKeys", { n: local.keys }));
  if (!activeHere) bits.push(t(part.startsWith("acc:") ? "mlcloud.notActiveAcc" : "mlcloud.notActiveDevice"));
  return (
    <div className={on ? "ml-dev" : "ml-dev is-off"}>
      <span className="ml-dev-icon" style={{ color: label.color }}>
        <Icon name={label.icon} size={20} />
      </span>
      <span className="ml-dev-text">
        <b>{label.title}</b>
        <span className="is-wrap">
          {label.sub} · {bits.join(", ")}
          {server ? ` · ${t("mlcloud.inCloud", { size: fmtBytes(server.bytes), time: timeAgo(server.updated_at, resolved) })}` : ` · ${t("mlcloud.notInCloud")}`}
        </span>
      </span>
      {children ?? (
        <button type="button" role="switch" aria-checked={on} aria-label={label.title} className={on ? "ml-switch is-on" : "ml-switch"} onClick={() => setPartOn(part, !on)}>
          <i />
        </button>
      )}
    </div>
  );
}

// ─── Ключ защиты (второй фактор) ──────────────────────────────────────────────

/**
 * Ключ защиты на устройстве: создать (у аккаунта ещё нет), ввести (есть) или сменить (`reset`). Созданный ключ
 * показывается один раз — `onReady` только после отметки «Я сохранил ключ».
 */
function VaultPanel({ info, reset, onReady }: { info: CloudInfo | null; reset?: boolean; onReady: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const hasSecret = useVaultSecret();
  const mfa = !!useMl().account?.mfa;
  const [shown, setShown] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.showToast({ title: errText(t, e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (shown) {
    const copy = () => void navigator.clipboard?.writeText(shown).then(() => setCopied(true));
    const download = () => {
      const url = URL.createObjectURL(new Blob([`MoeLibre Cloud - ${t("mlcloud.vault.title")}\n\n${shown}\n`], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "moelibre-cloud-key.txt";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    return (
      <div className="ml-vault">
        <b>{t("mlcloud.vault.shownTitle")}</b>
        <p>{t("mlcloud.vault.shownLead")}</p>
        <code className="ml-vault-key">{shown}</code>
        <div className="ml-vault-actions">
          <button type="button" className="ml-btn is-soft" style={ML_RED} onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? t("mlcloud.vault.copied") : t("mlcloud.vault.copy")}
          </button>
          <button type="button" className="ml-btn is-soft" style={ML_RED} onClick={download}>
            <Icon name="download" size={16} /> {t("mlcloud.vault.download")}
          </button>
        </div>
        <label className="ml-vault-check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>{t("mlcloud.vault.saved")}</span>
        </label>
        <button
          type="button"
          className="ml-btn is-primary is-wide"
          disabled={!saved}
          onClick={() => {
            setShown(null);
            onReady();
          }}
        >
          {t("mlcloud.vault.done")}
        </button>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="ml-vault">
        <Spinner size={18} />
      </div>
    );
  }

  // Облако — только с аутентификатором MoeLibre ID (второй фактор входа)
  if (!mfa) {
    return (
      <div className="ml-vault">
        <b>{t("mlcloud.vault.needMfa")}</b>
        <p>{t("mlcloud.vault.needMfaLead")}</p>
        <button type="button" className="ml-btn is-primary is-wide" onClick={() => navigate("/mlid/security")}>
          <Icon name="shield" size={16} /> {t("mlid.mfa.enable")}
        </button>
      </div>
    );
  }

  if (reset) {
    return (
      <div className="ml-vault">
        <b>{t("mlcloud.vault.resetTitle")}</b>
        <p>{t("mlcloud.vault.resetLead")}</p>
        <button
          type="button"
          className="ml-btn is-primary is-wide"
          disabled={busy}
          onClick={() => {
            if (!armed) return setArmed(true);
            void act(async () => setShown(await resetVaultKey()));
          }}
        >
          {busy ? <Spinner size={16} /> : armed ? t("mlcloud.confirmAgain") : t("mlcloud.vault.resetConfirm")}
        </button>
      </div>
    );
  }

  if (!info.vault) {
    return (
      <div className="ml-vault">
        <b>{t("mlcloud.vault.title")}</b>
        <p>{t("mlcloud.vault.createLead")}</p>
        <button type="button" className="ml-btn is-primary is-wide" disabled={busy} onClick={() => void act(async () => setShown(await createVaultKey()))}>
          {busy ? <Spinner size={16} /> : t("mlcloud.vault.create")}
        </button>
      </div>
    );
  }

  if (info.granted && hasSecret) {
    return (
      <div className="ml-vault is-ok">
        <Icon name="check-circle" size={18} />
        <span>{t("mlcloud.vault.ok")}</span>
      </div>
    );
  }

  return (
    <div className="ml-vault">
      <b>{t("mlcloud.vault.title")}</b>
      <p>{t("mlcloud.vault.enterLead")}</p>
      <input
        className="ml-vault-input"
        value={input}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        type="button"
        className="ml-btn is-primary is-wide"
        disabled={busy || !isVaultKeyLike(input)}
        onClick={() =>
          void act(async () => {
            await unlockVault(input);
            onReady();
          })
        }
      >
        {busy ? <Spinner size={16} /> : t("mlcloud.vault.confirm")}
      </button>
      <button type="button" className="ml-vault-lost" onClick={() => navigate("/mlid/cloud/setup?reset=1", { replace: true })}>
        {t("mlcloud.vault.lost")}
      </button>
    </div>
  );
}

// ─── Включение ────────────────────────────────────────────────────────────────

export function MlCloudSetupScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const cloud = useCloudState();
  const nh = useNhLink();
  const [busy, setBusy] = useState(false);
  const { search } = useLocation();
  const reset = new URLSearchParams(search).get("reset") === "1";
  const [info, reloadInfo] = useCloudInfo();
  const hasSecret = useVaultSecret();
  // Ключ защиты готов на устройстве (второй фактор) — только тогда облако можно включить
  const vaultReady = !!info?.granted && hasSecret;
  void cloud.off;

  // Облако уже включено, ключ ввели (разблокировали устройство) или сменили — назад в профиль
  const onVaultReady = () => {
    reloadInfo();
    if (cloud.enabled) {
      syncNow();
      toast.showToast({ title: t("mlcloud.vault.unlocked") });
      navigate("/mlid", { replace: true });
    }
  };

  const enable = async () => {
    setBusy(true);
    try {
      await enableCloud();
      const info = await fetchCloudInfo();
      const decided = new Set(info.imports.map((i) => i.external_id));
      const needImport = (nh.accounts ?? []).some((a) => !decided.has(String(a.id)));
      toast.showToast({ title: t("mlcloud.enabled") });
      navigate(needImport ? "/mlid/cloud/import" : "/mlid", { replace: true });
    } catch (e) {
      toast.showToast({ title: errText(t, e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const others = (nh.accounts ?? []).filter((a) => !deviceParts().includes(`acc:nhentai:${a.id}`));

  // Облако уже включено (или меняем ключ): здесь только ключ защиты
  if (cloud.enabled || reset) {
    return (
      <div className="screen-scroll ml-acc">
        <section className="ml-setup-hero">
          <span className="ml-cloud-icon is-big">
            <Icon name="shield" size={30} />
          </span>
          <h2>{t("mlcloud.vault.title")}</h2>
          <p>{t("mlcloud.vault.lead")}</p>
        </section>
        <VaultPanel info={info} reset={reset} onReady={onVaultReady} />
      </div>
    );
  }

  return (
    <div className="screen-scroll ml-acc">
      <section className="ml-setup-hero">
        <span className="ml-cloud-icon is-big">
          <Icon name="cloud" size={30} />
        </span>
        <h2>{t("mlcloud.setupTitle")}</h2>
        <p>{t("mlcloud.setupLead")}</p>
      </section>

      <div className="ml-sec-head">
        <h3>{t("mlcloud.setupWhat")}</h3>
      </div>
      <div className="ml-panel">
        {deviceParts().map((p) => (
          <PartRow key={p} part={p} />
        ))}
      </div>
      {others.length > 0 && <p className="ml-note">{t("mlcloud.setupOthers", { names: others.map((a) => a.username).join(", ") })}</p>}

      <div className="ml-warn">
        <Icon name="shield" size={20} />
        <div>
          <b>{t("mlcloud.warnTitle")}</b>
          <ul>
            <li>{t("mlcloud.warn1")}</li>
            <li>{t("mlcloud.warn2")}</li>
            <li>{t("mlcloud.warn3")}</li>
          </ul>
        </div>
      </div>

      <div className="ml-sec-head">
        <h3>{t("mlcloud.vault.title")}</h3>
      </div>
      <p className="ml-note">{t("mlcloud.vault.lead")}</p>
      <VaultPanel info={info} onReady={reloadInfo} />

      <button type="button" className="ml-btn is-primary is-big is-wide" onClick={() => void enable()} disabled={busy || !vaultReady}>
        {busy ? <Spinner size={18} /> : t("mlcloud.enableConfirm")}
      </button>
    </div>
  );
}

// ─── Перенос из старого облака ────────────────────────────────────────────────

type ImportRow = {
  id: number;
  username: string;
  status: "loading" | "ready" | "empty" | "busy" | "done" | "declined" | "error";
  summary?: ReturnType<typeof summarizeSnapshot>;
  snap?: Record<string, string>;
  error?: string;
};

export function MlCloudImportScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { search } = useLocation();
  const nh = useNhLink();
  const [info] = useCloudInfo();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const all = new URLSearchParams(search).get("all") === "1";

  useEffect(() => {
    if (!info || !nh.accounts) return;
    const decided = new Set(info.imports.map((i) => i.external_id));
    const list = nh.accounts.filter((a) => all || !decided.has(String(a.id)));
    setRows(list.map((a) => ({ id: a.id, username: a.username, status: "loading" })));
    for (const a of list) {
      fetchNappiSnapshot(a.id).then(
        (snap) => {
          const summary = summarizeSnapshot(snap);
          const empty = !summary.favorites && !summary.history && !summary.settings;
          setRows((cur) => cur?.map((r) => (r.id === a.id ? { ...r, snap, summary, status: empty ? "empty" : "ready" } : r)) ?? null);
          if (empty) void decideImport(a.id, "declined").catch(() => undefined);
        },
        (e) => setRows((cur) => cur?.map((r) => (r.id === a.id ? { ...r, status: "error", error: errText(t, e) } : r)) ?? null),
      );
    }
  }, [info, nh.accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id: number, p: Partial<ImportRow>) => setRows((cur) => cur?.map((r) => (r.id === id ? { ...r, ...p } : r)) ?? null);

  const doImport = async (r: ImportRow) => {
    update(r.id, { status: "busy" });
    try {
      await importFromNappi(r.id, r.snap ?? {});
      update(r.id, { status: "done" });
    } catch (e) {
      update(r.id, { status: "error", error: errText(t, e) });
    }
  };

  const decline = async (r: ImportRow) => {
    update(r.id, { status: "busy" });
    try {
      await decideImport(r.id, "declined");
      update(r.id, { status: "declined" });
    } catch (e) {
      update(r.id, { status: "error", error: errText(t, e) });
    }
  };

  const finished = rows != null && rows.every((r) => r.status === "done" || r.status === "declined" || r.status === "empty");

  return (
    <div className="screen-scroll ml-acc">
      <p className="ml-page-lead">{t("mlcloud.importLead")}</p>
      {!rows && (
        <div className="ml-acc-loading">
          <Spinner size={22} />
        </div>
      )}
      {rows?.length === 0 && (
        <div className="ml-panel">
          <div className="ml-empty">{t("mlcloud.importNothing")}</div>
        </div>
      )}
      {rows?.map((r) => (
        <div key={r.id} className="ml-import" style={{ "--c": "#ed2553" } as CSSProperties}>
          <div className="ml-import-head">
            <span className="ml-res-mark">nh</span>
            <span className="ml-res-text">
              <b>{r.username}</b>
              <span className="is-wrap">
                {r.status === "loading" && t("mlcloud.importChecking")}
                {r.status === "empty" && t("mlcloud.importEmpty")}
                {r.status === "done" && t("mlcloud.importDone")}
                {r.status === "declined" && t("mlcloud.importDeclined")}
                {r.status === "error" && r.error}
                {(r.status === "ready" || r.status === "busy") &&
                  r.summary &&
                  t("mlcloud.importFound", { fav: r.summary.favorites, hist: r.summary.history, set: r.summary.settings })}
              </span>
            </span>
            {(r.status === "loading" || r.status === "busy") && <Spinner size={18} />}
            {(r.status === "done" || r.status === "declined" || r.status === "empty") && <Icon name="check" size={20} />}
          </div>
          {r.status === "ready" && (
            <div className="ml-import-actions">
              <button type="button" className="ml-btn is-primary" onClick={() => void doImport(r)}>
                {t("mlcloud.importYes")}
              </button>
              <button type="button" className="ml-btn is-ghost" onClick={() => void decline(r)}>
                {t("mlcloud.importNo")}
              </button>
            </div>
          )}
        </div>
      ))}
      <p className="ml-note">{t("mlcloud.importHint")}</p>
      {finished && (
        <button type="button" className="ml-btn is-primary is-big is-wide" onClick={() => navigate("/mlid", { replace: true })}>
          {t("mlcloud.importFinish")}
        </button>
      )}
    </div>
  );
}

// ─── Что синхронизируется ─────────────────────────────────────────────────────

export function MlCloudDataScreen() {
  const { t } = useI18n();
  const cloud = useCloudState();
  const [info] = useCloudInfo([cloud.lastSync?.at]);
  const accounts = useNhAccounts();
  const parts = allKnownParts(
    accounts.map((a) => a.id),
    (info?.parts ?? []).map((p) => p.part),
  );
  void cloud.off;

  return (
    <div className="screen-scroll ml-acc">
      <p className="ml-page-lead">{t("mlcloud.dataLead")}</p>
      <div className="ml-panel">
        {parts.map((p) => (
          <PartRow key={p} part={p} server={info?.parts.find((x) => x.part === p)} />
        ))}
      </div>
      <p className="ml-note">{t("mlcloud.dataHint")}</p>
    </div>
  );
}

// ─── Устройства ───────────────────────────────────────────────────────────────

export function MlCloudDevicesScreen() {
  const { t, resolved } = useI18n();
  const cloud = useCloudState();
  const me = getDeviceId();
  const last = cloud.lastSync;

  return (
    <div className="screen-scroll ml-acc">
      <p className="ml-page-lead">{t("mlcloud.devicesLead")}</p>
      <div className="ml-panel">
        {cloud.peers.length === 0 && <div className="ml-empty">{cloud.status === "online" ? t("mlcloud.noPeers") : t("mlcloud.connecting")}</div>}
        {cloud.peers.map((p) => {
          const current = p.device_id === me;
          const sender = last?.fromDeviceId === p.device_id;
          return (
            <div key={p.device_id} className={current ? "ml-dev is-current" : "ml-dev"}>
              <span className="ml-dev-icon">
                <Icon name={/android|phone/i.test(p.device_name ?? "") ? "smartphone" : "layout"} size={20} />
              </span>
              <span className="ml-dev-text">
                <b>{p.device_name || p.device_id}</b>
                <span>
                  {current ? t("mlid.thisDevice") : t("mlcloud.online")}
                  {sender && last && ` · ${t("mlcloud.sentAgo", { time: timeAgo(last.at, resolved) })}`}
                </span>
              </span>
              <i className="ml-live-dot" aria-hidden />
            </div>
          );
        })}
      </div>
      {last && <p className="ml-note">{t("mlcloud.lastFanout", { time: timeAgo(last.at, resolved), keys: last.keysCount, n: last.recipientCount })}</p>}
    </div>
  );
}

// ─── Управление ───────────────────────────────────────────────────────────────

function ManageRow({
  icon,
  title,
  sub,
  danger,
  armed,
  busy,
  disabled,
  onClick,
}: {
  icon: IconName;
  title: string;
  sub: string;
  danger?: boolean;
  armed?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`ml-manage${danger ? " is-danger" : ""}${armed ? " is-armed" : ""}`} disabled={disabled} onClick={onClick}>
      <span className="ml-dev-icon">{busy ? <Spinner size={18} /> : <Icon name={icon} size={20} />}</span>
      <span className="ml-dev-text">
        <b>{title}</b>
        <span className="is-wrap">{sub}</span>
      </span>
    </button>
  );
}

export function MlCloudManageScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const toast = useToast();
  const [info, reload] = useCloudInfo();
  const [arming, setArming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!arming) return;
    const timer = window.setTimeout(() => setArming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [arming]);

  const run = async (key: string, fn: () => Promise<void>, done?: string): Promise<boolean> => {
    setBusy(key);
    try {
      await fn();
      if (done) toast.showToast({ title: done });
      reload();
      return true;
    } catch (e) {
      toast.showToast({ title: errText(t, e), type: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** Опасное — со второго нажатия. */
  const twoTap = (key: string, fn: () => void) => () => {
    if (arming !== key) return setArming(key);
    setArming(null);
    fn();
  };

  const total = (info?.parts ?? []).reduce((s, p) => s + p.bytes, 0);

  return (
    <div className="screen-scroll ml-acc">
      <p className="ml-page-lead">{info ? t("mlcloud.manageLead", { parts: info.parts.length, size: fmtBytes(total) }) : t("mlcloud.connecting")}</p>
      <div className="ml-panel">
        <ManageRow icon="download" title={t("mlcloud.export")} sub={t("mlcloud.exportSub")} busy={busy === "export"} disabled={busy != null} onClick={() => void run("export", exportCloud)} />
        <ManageRow icon="key" title={t("mlcloud.vault.manageRow")} sub={t("mlcloud.vault.manageRowSub")} disabled={busy != null} onClick={() => navigate("/mlid/cloud/setup?reset=1")} />
        <ManageRow icon="upload" title={t("mlcloud.reimport")} sub={t("mlcloud.reimportSub")} disabled={busy != null} onClick={() => navigate("/mlid/cloud/import?all=1")} />
      </div>
      <div className="ml-sec-head">
        <h3>{t("mlcloud.danger")}</h3>
      </div>
      <div className="ml-panel">
        <ManageRow
          icon="cloud"
          title={arming === "disable" ? t("mlcloud.confirmAgain") : t("mlcloud.disable")}
          sub={t("mlcloud.disableSub")}
          armed={arming === "disable"}
          busy={busy === "disable"}
          disabled={busy != null}
          onClick={twoTap("disable", () => void run("disable", () => disableCloud(false), t("mlcloud.disabled")).then((ok) => ok && navigate("/mlid", { replace: true })))}
        />
        <ManageRow
          icon="trash-2"
          title={arming === "wipe" ? t("mlcloud.confirmAgain") : t("mlcloud.wipe")}
          sub={t("mlcloud.wipeSub")}
          danger
          armed={arming === "wipe"}
          busy={busy === "wipe"}
          disabled={busy != null}
          onClick={twoTap("wipe", () => void run("wipe", () => disableCloud(true), t("mlcloud.wiped")).then((ok) => ok && navigate("/mlid", { replace: true })))}
        />
      </div>
    </div>
  );
}
