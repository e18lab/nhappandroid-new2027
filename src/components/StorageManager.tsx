/**
 * Хранилище устройства — перенос `components/settings/StorageManager.tsx` (релиз 1.3.1).
 * Все ключи с размерами и поиском, раскрытие значения, правка / копирование / удаление ключа,
 * экспорт в JSON-файл, импорт из файла и из буфера, «Очистить всё».
 *
 * Отличия от старого:
 *  - «Перезаписать существующие» в старом ни на что не влиял — здесь при выключенной галочке
 *    существующие ключи при импорте не трогаются;
 *  - «Очистить всё» не стирает служебные ключи `legacyImport.v1` и `@cloud.deviceId`: без первого
 *    при следующем запуске заново подтянулись бы данные 1.3.1, без второго сервер увидел бы новое устройство.
 * Экспорт на Android — системное «Поделиться» (как `expo-sharing`), в браузере — скачивание файла.
 * Тема и полноэкранный режим после правки применяются подпиской в `App.tsx`, облако — через `cloudSync`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { getAll, KEYS, removeItem, setItem, subscribe } from "../lib/storage";
import "../shell/systemUi";
import { Icon, NhModal, useToast, type IconName } from "../ui";

/** Ключи, которые переживают «Очистить всё» и импорт с очисткой. */
const KEEP_ON_CLEAR = new Set<string>(["legacyImport.v1", KEYS.cloudDeviceId]);

type KV = { key: string; value: string };

function readAll(): KV[] {
  return Object.entries(getAll())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function pretty(v: string, max = 240): string {
  let out = v;
  try {
    out = JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    /* не JSON — как есть */
  }
  return out.length > max ? out.slice(0, max) + "…" : out;
}

function clearAllKeys() {
  for (const k of Object.keys(getAll())) if (!KEEP_ON_CLEAR.has(k)) removeItem(k);
}

function Chip({
  icon,
  label,
  onClick,
  tone = "tag",
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  tone?: "tag" | "danger" | "inc" | "accent";
}) {
  return (
    <button type="button" className={`sm-chip is-${tone}`} onClick={onClick}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

export function StorageManager() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [items, setItems] = useState<KV[]>(readAll);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [overrideExisting, setOverrideExisting] = useState(true);
  const [wipeBeforeImport, setWipeBeforeImport] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = () => setItems(readAll());

  // Любое изменение хранилища (в т.ч. из облака) — перечитать; пачку событий схлопываем в одно
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribe(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        reload();
      }, 150);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.key.toLowerCase().includes(q) || i.value.toLowerCase().includes(q));
  }, [items, query]);

  const totalSize = useMemo(() => items.reduce((a, i) => a + i.key.length + i.value.length, 0), [items]);

  const ask = (message: string) => new Promise<boolean>((resolve) => setConfirm({ message, resolve }));
  const answer = (ok: boolean) => {
    confirm?.resolve(ok);
    setConfirm(null);
  };

  const notice = (title: string, message: string, type: "success" | "error" = "success") =>
    showToast({ type, title, message });

  const exportAll = () => {
    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        platform: window.NHAppNative ? "android" : "web",
        totalItems: items.length,
        totalBytes: totalSize,
      },
      data: Object.fromEntries(items.map((i) => [i.key, i.value])),
    };
    const json = JSON.stringify(payload, null, 2);
    const fileName = `storage-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    try {
      if (window.NHAppNative?.shareText) {
        if (!window.NHAppNative.shareText(fileName, "application/json", json)) throw new Error("share");
        return;
      }
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notice(t("storageManager.export.title"), t("storageManager.export.failed", { error: String(e) }), "error");
    }
  };

  const importJson = async (raw: string) => {
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      data = parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
    } catch (e) {
      notice(t("storageManager.import.title"), t("storageManager.import.invalidJson", { error: String(e) }), "error");
      return;
    }
    if (wipeBeforeImport) {
      if (!(await ask(t("storageManager.confirm.wipeBeforeImport")))) return;
      clearAllKeys();
    }
    const existing = getAll();
    let count = 0;
    for (const [k, v] of Object.entries(data)) {
      if (KEEP_ON_CLEAR.has(k)) continue;
      if (!overrideExisting && k in existing) continue;
      setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      count++;
    }
    notice(t("storageManager.import.title"), t("storageManager.import.ok", { count }));
    reload();
  };

  const importFromFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importJson(await file.text());
    } catch (e) {
      notice(t("storageManager.import.title"), t("storageManager.import.error", { error: String(e) }), "error");
    }
  };

  const importFromClipboard = async () => {
    try {
      const raw = window.NHAppNative?.clipboardText ? window.NHAppNative.clipboardText() : await navigator.clipboard.readText();
      if (!raw) {
        notice(t("storageManager.import.title"), t("storageManager.import.clipboardEmpty"), "error");
        return;
      }
      await importJson(raw);
    } catch (e) {
      notice(t("storageManager.import.title"), t("storageManager.import.error", { error: String(e) }), "error");
    }
  };

  const removeKey = async (k: string) => {
    if (!(await ask(t("storageManager.confirm.deleteKey", { key: k })))) return;
    removeItem(k);
    reload();
  };

  const clearAll = async () => {
    if (!(await ask(t("storageManager.confirm.clearAll")))) return;
    clearAllKeys();
    reload();
  };

  const saveEdit = () => {
    if (editKey == null) return;
    setItem(editKey, editVal);
    setEditKey(null);
    reload();
  };

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      showToast({ title: t("comments.copied") });
    } catch {
      /* буфер недоступен */
    }
  };

  return (
    <div className="settings-card sm">
      <div className="sm-head">
        <span className="sm-head-icon">
          <Icon name="database" size={18} />
        </span>
        <div>
          <div className="sm-title">{t("storageManager.title")}</div>
          <div className="sm-meta">{t("storageManager.meta", { count: items.length, size: (totalSize / 1024).toFixed(1) })}</div>
        </div>
      </div>

      <div className="sm-search">
        <Icon name="search" size={14} />
        <input
          value={query}
          placeholder={t("storageManager.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" aria-label={t("common.retry")} onClick={reload}>
          <Icon name="refresh-ccw" size={16} />
        </button>
      </div>

      <div className="sm-actions">
        <Chip icon="download" label={t("storageManager.actions.export")} onClick={exportAll} />
        <Chip icon="upload" label={t("storageManager.actions.importFile")} onClick={() => fileInput.current?.click()} />
        <Chip icon="clipboard" label={t("storageManager.actions.importClipboard")} onClick={() => void importFromClipboard()} />
        <Chip icon="trash-2" label={t("storageManager.actions.clearAll")} tone="danger" onClick={() => void clearAll()} />
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void importFromFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="sm-opts">
        <button type="button" onClick={() => setOverrideExisting((v) => !v)}>
          <Icon name={overrideExisting ? "check-square" : "square"} size={14} />
          {t("storageManager.options.overwrite")}
        </button>
        <button type="button" onClick={() => setWipeBeforeImport((v) => !v)}>
          <Icon name={wipeBeforeImport ? "check-square" : "square"} size={14} />
          {t("storageManager.options.wipeBeforeImport")}
        </button>
      </div>

      <div className="sm-list">
        {filtered.map((it) => {
          const open = !!expanded[it.key];
          return (
            <div key={it.key} className="sm-item">
              <button type="button" className="sm-item-head" onClick={() => setExpanded((m) => ({ ...m, [it.key]: !open }))}>
                <span className="sm-key">{it.key}</span>
                <span className="sm-size">
                  {it.value.length + t("storageManager.bytesSuffix")}
                  <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
                </span>
              </button>
              {open && (
                <div className="sm-item-body">
                  <pre className="sm-value">{pretty(it.value)}</pre>
                  <div className="sm-item-actions">
                    <Chip
                      icon="edit-2"
                      label={t("storageManager.actions.edit")}
                      tone="inc"
                      onClick={() => {
                        setEditKey(it.key);
                        setEditVal(it.value);
                      }}
                    />
                    <Chip icon="copy" label={t("storageManager.actions.copy")} onClick={() => void copy(it.value)} />
                    <Chip icon="trash-2" label={t("storageManager.actions.delete")} tone="danger" onClick={() => void removeKey(it.key)} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!filtered.length && <p className="sm-empty">{t("storageManager.noMatches")}</p>}
      </div>

      <NhModal visible={editKey != null} onClose={() => setEditKey(null)} title={t("storageManager.modal.editTitle")} hint={editKey ?? ""}>
        <div className="sm-edit">
          <textarea
            value={editVal}
            placeholder={t("storageManager.modal.valuePlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setEditVal(e.target.value)}
          />
          <div className="sm-item-actions">
            <Chip icon="save" label={t("common.save")} tone="accent" onClick={saveEdit} />
            <Chip icon="x" label={t("common.cancel")} onClick={() => setEditKey(null)} />
          </div>
        </div>
      </NhModal>

      <NhModal visible={confirm != null} onClose={() => answer(false)} title={t("storageManager.confirm.title")}>
        <div className="fo-confirm">
          <p className="sm-confirm-text">{confirm?.message}</p>
          <div>
            <button type="button" onClick={() => answer(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="is-accent" onClick={() => answer(true)}>
              {t("common.yes")}
            </button>
          </div>
        </div>
      </NhModal>
    </div>
  );
}
