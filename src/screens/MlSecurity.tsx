/**
 * `/mlid/security` — аутентификатор MoeLibre ID (второй фактор входа, TOTP: Google Authenticator, Aegis, 2FAS…).
 *  - Подключение: секрет добавляется в приложение-аутентификатор (кнопкой — на телефоне, ключом вручную — на ПК),
 *    подтверждается кодом; после этого — 10 резервных кодов, они показываются один раз.
 *  - Включённый: вход в MoeLibre ID на новом устройстве просит код; облако без аутентификатора не включается.
 *  - Новые резервные коды и выключение — по коду.
 */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { disableMlMfa, enableMlMfa, getMlMfa, MlError, regenerateMlRecovery, setupMlMfa, type MlMfaStatus } from "../lib/mlid";
import { Icon, Spinner, useToast } from "../ui";

type T = ReturnType<typeof useI18n>["t"];

function errText(t: T, e: unknown): string {
  const code = e instanceof MlError ? e.code : String((e as Error)?.message ?? e);
  const key = `mlid.err.${code}`;
  const text = t(key);
  return text === key ? t("mlid.err.generic", { code }) : text;
}

/** Поле кода: 6 цифр или резервный код. */
function CodeInput({ value, onChange, onSubmit, busy, label }: { value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean; label: string }) {
  return (
    <form
      className="ml-mfa-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length >= 6) onSubmit();
      }}
    >
      <input className="ml-mfa-input" value={value} inputMode="text" autoComplete="one-time-code" placeholder="123 456" onChange={(e) => onChange(e.target.value)} />
      <button type="submit" className="ml-btn is-primary" disabled={busy || value.trim().length < 6}>
        {busy ? <Spinner size={16} /> : label}
      </button>
    </form>
  );
}

/** Резервные коды: показать один раз, скопировать или сохранить файлом. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([`MoeLibre ID - ${t("mlid.mfa.recoveryTitle")}\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "moelibre-id-recovery-codes.txt";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="ml-vault">
      <b>{t("mlid.mfa.recoveryTitle")}</b>
      <p>{t("mlid.mfa.recoveryLead")}</p>
      <div className="ml-mfa-codes">
        {codes.map((c) => (
          <code key={c}>{c}</code>
        ))}
      </div>
      <div className="ml-vault-actions">
        <button type="button" className="ml-btn is-soft" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
          <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? t("mlcloud.vault.copied") : t("mlcloud.vault.copy")}
        </button>
        <button type="button" className="ml-btn is-soft" onClick={download}>
          <Icon name="download" size={16} /> {t("mlcloud.vault.download")}
        </button>
      </div>
      <label className="ml-vault-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t("mlid.mfa.recoverySaved")}</span>
      </label>
      <button type="button" className="ml-btn is-primary is-wide" disabled={!saved} onClick={onDone}>
        {t("mlcloud.vault.done")}
      </button>
    </div>
  );
}

export function MlSecurityScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState<MlMfaStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "disable" | "recovery">("none");
  const [copied, setCopied] = useState(false);

  const load = () =>
    void getMlMfa().then(setStatus, (e) => {
      toast.showToast({ title: errText(t, e), type: "error" });
    });
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setCode("");
    } catch (e) {
      toast.showToast({ title: errText(t, e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const hero = (
    <section className="ml-setup-hero">
      <span className="ml-cloud-icon is-big">
        <Icon name="shield" size={30} />
      </span>
      <h2>{t("mlid.mfa.title")}</h2>
      <p>{t("mlid.mfa.lead")}</p>
    </section>
  );

  if (codes) {
    return (
      <div className="screen-scroll ml-acc">
        {hero}
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            setMode("none");
            load();
          }}
        />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="screen-scroll ml-acc">
        {hero}
        <div className="ml-vault">
          <Spinner size={18} />
        </div>
      </div>
    );
  }

  // Подключение: ключ в приложение-аутентификатор, затем код
  if (!status.enabled) {
    return (
      <div className="screen-scroll ml-acc">
        {hero}
        {!setup ? (
          <div className="ml-vault">
            <b>{t("mlid.mfa.off")}</b>
            <p>{t("mlid.mfa.offLead")}</p>
            <button type="button" className="ml-btn is-primary is-wide" disabled={busy} onClick={() => void act(async () => setSetup(await setupMlMfa()))}>
              {busy ? <Spinner size={16} /> : t("mlid.mfa.enable")}
            </button>
          </div>
        ) : (
          <div className="ml-vault">
            <b>{t("mlid.mfa.step1")}</b>
            <p>{t("mlid.mfa.step1Lead")}</p>
            <a className="ml-btn is-soft is-wide" href={setup.uri}>
              <Icon name="key" size={16} /> {t("mlid.mfa.openApp")}
            </a>
            <code className="ml-vault-key">{setup.secret.replace(/(.{4})(?=.)/g, "$1 ")}</code>
            <button type="button" className="ml-btn is-soft" onClick={() => void navigator.clipboard?.writeText(setup.secret).then(() => setCopied(true))}>
              <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? t("mlcloud.vault.copied") : t("mlid.mfa.copySecret")}
            </button>
            <b>{t("mlid.mfa.step2")}</b>
            <p>{t("mlid.mfa.step2Lead")}</p>
            <CodeInput value={code} onChange={setCode} busy={busy} label={t("mlid.mfa.confirm")} onSubmit={() => void act(async () => setCodes(await enableMlMfa(code)))} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="screen-scroll ml-acc">
      {hero}
      <div className="ml-vault is-ok">
        <Icon name="check-circle" size={18} />
        <span>{t("mlid.mfa.on")}</span>
      </div>
      <p className="ml-note">{t("mlid.mfa.recoveryLeft", { n: status.recovery_left })}</p>

      <div className="ml-vault">
        <div className="ml-vault-actions">
          <button type="button" className={mode === "recovery" ? "ml-btn is-primary" : "ml-btn is-soft"} onClick={() => setMode(mode === "recovery" ? "none" : "recovery")}>
            <Icon name="refresh-cw" size={16} /> {t("mlid.mfa.newRecovery")}
          </button>
          <button type="button" className={mode === "disable" ? "ml-btn is-primary" : "ml-btn is-soft"} onClick={() => setMode(mode === "disable" ? "none" : "disable")}>
            <Icon name="x-circle" size={16} /> {t("mlid.mfa.disable")}
          </button>
        </div>
        {mode !== "none" && (
          <>
            <p>{mode === "disable" ? t("mlid.mfa.disableLead") : t("mlid.mfa.newRecoveryLead")}</p>
            <CodeInput
              value={code}
              onChange={setCode}
              busy={busy}
              label={mode === "disable" ? t("mlid.mfa.disable") : t("mlid.mfa.confirm")}
              onSubmit={() =>
                void act(async () => {
                  if (mode === "disable") {
                    await disableMlMfa(code);
                    toast.showToast({ title: t("mlid.mfa.disabled") });
                    setMode("none");
                    load();
                  } else setCodes(await regenerateMlRecovery(code));
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
