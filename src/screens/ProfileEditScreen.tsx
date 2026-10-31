/**
 * Настройки профиля — перенос `app/profile/[id]/edit.tsx` (релиз 1.3.1); открываются из настроек как «Аккаунт»
 * (`/settings/account`), вид — как страница аккаунта в настройках Telegram.
 * Аватар (сменить / удалить), имя, email, «о себе», любимые теги, чёрный список тегов, смена пароля, выход.
 * Кнопка «Сохранить» появляется, когда что-то изменено; в старом она жила в шапке, здесь — плавающая снизу.
 *
 * Аватар: в старом галерея с обрезкой 1:1 и качеством 0.85 — здесь выбор файла и обрезка по центру в квадрат.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getBlacklist, getMe, getUserProfile, updateBlacklist, updateProfile, uploadAvatar } from "../api/account";
import { ApiError } from "../api/client";
import { autocompleteTags } from "../api/tags";
import type { TagShort, TagType } from "../api/types";
import { avatarUrl } from "../components/CommentCard";
import { useI18n } from "../i18n/I18nContext";
import { setBlacklistCache } from "../lib/blacklist";
import { refreshMe, signOut } from "../lib/session";
import { Icon, ListField, ListHint, LoadingSpinner, Select, Spinner, TileIcon, useToast } from "../ui";

interface FormData {
  username: string;
  email: string;
  about: string;
  favorite_tags: string;
  old_password: string;
  new_password1: string;
  new_password2: string;
}

const BLACKLIST_TYPES: { value: TagType; label: string }[] = [
  { value: "tag", label: "Tag" },
  { value: "artist", label: "Artist" },
  { value: "character", label: "Character" },
  { value: "parody", label: "Parody" },
  { value: "group", label: "Group" },
  { value: "language", label: "Language" },
  { value: "category", label: "Category" },
];

const AVATAR_SIZE = 512;

/** Центральный квадрат картинки → JPEG (как allowsEditing + aspect 1:1 + quality 0.85). */
async function squareAvatar(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file; // анимацию не трогаем
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(side, AVATAR_SIZE);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85),
  );
}

export function ProfileEditScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormData | null>(null);
  const baseline = useRef<FormData | null>(null);

  const serverAvatar = useRef("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarFile, setAvatarFile] = useState<Blob | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [showPasswords, setShowPasswords] = useState(false);

  const [showBlacklist, setShowBlacklist] = useState(false);
  const [blLoading, setBlLoading] = useState(false);
  const [blError, setBlError] = useState(false);
  const blLoaded = useRef(false);
  const blBaseline = useRef<Set<number>>(new Set());
  const [blTags, setBlTags] = useState<TagShort[]>([]);
  const [blType, setBlType] = useState<TagType>("tag");
  const [blQuery, setBlQuery] = useState("");
  const [blSuggest, setBlSuggest] = useState<TagShort[]>([]);
  const [blSuggestLoading, setBlSuggestLoading] = useState(false);
  const blReq = useRef(0);

  const errorToast = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        const body = e.body as { error?: unknown } | null | undefined;
        const bodyErr = body && typeof body === "object" && "error" in body ? String(body.error) : null;
        const known = bodyErr?.toLowerCase().includes("avatar upload not yet implemented")
          ? t("toast.avatarUploadNotImplemented")
          : null;
        showToast({
          type: "error",
          title: t("toast.httpErrorTitle", { code: e.status }),
          message: known || bodyErr || e.message.trim() || t("toast.httpErrorGeneric", { code: e.status }),
        });
        return;
      }
      showToast({
        type: "error",
        title: t("toast.errorTitle"),
        message: e instanceof Error && e.message ? e.message : t("toast.genericFailure"),
      });
    },
    [showToast, t],
  );

  const loadForm = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const me = await getMe();
      // about и favorite_tags в /user не приходят — берём из публичного профиля
      let about = "";
      let favorite_tags = "";
      try {
        const pub = await getUserProfile(me.id, me.slug);
        about = pub.about ?? "";
        favorite_tags = pub.favorite_tags ?? "";
      } catch {
        /* оставим пустыми */
      }
      const next: FormData = {
        username: me.username ?? "",
        email: me.email ?? "",
        about,
        favorite_tags,
        old_password: "",
        new_password1: "",
        new_password2: "",
      };
      baseline.current = next;
      setForm(next);
      serverAvatar.current = avatarUrl(me.avatar_url);
      setAvatarPreview(serverAvatar.current);
      setAvatarFile(null);
      setRemoveAvatar(false);
    } catch (e) {
      setLoadError(e instanceof ApiError && e.status === 401 ? t("profile.edit.notLoggedIn") : e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  // Превью выбранного файла живёт как object URL — освобождаем при смене
  useEffect(() => {
    if (!avatarFile) return;
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  // Чёрный список грузится при первом раскрытии секции
  useEffect(() => {
    if (!showBlacklist || blLoading || blLoaded.current) return;
    blLoaded.current = true;
    setBlLoading(true);
    setBlError(false);
    getBlacklist()
      .then((bl) => {
        const tags = Array.isArray(bl.tags) ? bl.tags : [];
        setBlTags(tags);
        setBlacklistCache(tags);
        blBaseline.current = new Set(tags.map((x) => x.id));
      })
      .catch((e) => {
        setBlError(true);
        errorToast(e);
      })
      .finally(() => setBlLoading(false));
  }, [showBlacklist, blLoading, errorToast]);

  const runSuggest = useCallback(async (q: string, type: TagType, silent = false) => {
    const my = ++blReq.current;
    if (!silent) setBlSuggestLoading(true);
    try {
      const res = await autocompleteTags({ query: q, type, limit: 15 });
      if (blReq.current !== my) return;
      setBlSuggest(res.map((x) => ({ id: x.id, name: x.name, slug: "", type: x.type || type, count: x.count ?? 0 })));
    } catch {
      if (blReq.current === my) setBlSuggest([]);
    } finally {
      if (!silent && blReq.current === my) setBlSuggestLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showBlacklist || blLoading) return;
    const q = blQuery.trim();
    const timer = setTimeout(() => void runSuggest(q, blType), q ? 220 : 80);
    return () => clearTimeout(timer);
  }, [blQuery, blType, blLoading, showBlacklist, runSuggest]);

  const visibleSuggest = useMemo(() => {
    if (!blTags.length) return blSuggest;
    const picked = new Set(blTags.map((x) => x.id));
    return blSuggest.filter((s) => !picked.has(s.id));
  }, [blSuggest, blTags]);

  const isDirty = useMemo(() => {
    const base = baseline.current;
    if (!form || !base) return false;
    const fields = (Object.keys(base) as (keyof FormData)[]).some((k) => form[k] !== base[k]);
    const avatar = removeAvatar || !!avatarFile;
    const baseIds = blBaseline.current;
    const bl = blTags.some((x) => !baseIds.has(x.id)) || [...baseIds].some((id) => !blTags.some((x) => x.id === id));
    return fields || avatar || bl;
  }, [form, removeAvatar, avatarFile, blTags]);

  const update = (patch: Partial<FormData>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatarFile(await squareAvatar(file));
      setRemoveAvatar(false);
    } catch (e) {
      errorToast(e);
    }
  };

  const dropAvatar = () => {
    setRemoveAvatar(true);
    setAvatarFile(null);
    setAvatarPreview("");
  };

  const submit = async () => {
    if (!form) return;
    if (form.new_password1 !== form.new_password2) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: t("login.form.passwordMismatch") });
      return;
    }
    setSaving(true);
    try {
      const baseIds = blBaseline.current;
      const currIds = new Set(blTags.map((x) => x.id));
      const added = [...currIds].filter((id) => !baseIds.has(id));
      const removed = [...baseIds].filter((id) => !currIds.has(id));

      await updateProfile({
        username: form.username || undefined,
        email: form.email || undefined,
        about: form.about || undefined,
        favorite_tags: form.favorite_tags || undefined,
        current_password: form.old_password || undefined,
        new_password: form.new_password1 || undefined,
        remove_avatar: removeAvatar || undefined,
      });

      if (!removeAvatar && avatarFile) {
        const res = await uploadAvatar(avatarFile, avatarFile.type === "image/gif" ? "avatar.gif" : "avatar.jpg");
        if (res.avatar_url) serverAvatar.current = avatarUrl(res.avatar_url);
      }
      if (removeAvatar) serverAvatar.current = "";

      if (added.length || removed.length) {
        await updateBlacklist({ added, removed });
        blBaseline.current = currIds;
        setBlacklistCache(blTags);
      }

      showToast({ type: "success", title: t("profile.edit.saved") });
      const cleared = { ...form, old_password: "", new_password1: "", new_password2: "" };
      baseline.current = cleared;
      setForm(cleared);
      // Выбор/удаление аватара — действие, а не «несохранённое» состояние
      setAvatarFile(null);
      setRemoveAvatar(false);
      setAvatarPreview(serverAvatar.current);
      void refreshMe();
    } catch (e) {
      // Если аватар не прошёл — вернуть серверный
      if (removeAvatar || avatarFile) {
        setAvatarFile(null);
        setRemoveAvatar(false);
        setAvatarPreview(serverAvatar.current);
      }
      errorToast(e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  if (loadError && !form) {
    return (
      <div className="screen-fill pe-error">
        <Icon name="alert-circle" size={40} />
        <p>{loadError}</p>
        <div>
          <button type="button" onClick={() => navigate(-1)}>
            <Icon name="arrow-left" size={16} />
            {t("common.back")}
          </button>
          <button type="button" className="is-accent" onClick={() => void loadForm()}>
            <Icon name="refresh-cw" size={16} />
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!form) return null;

  const hasAvatar = !!avatarPreview;

  return (
    <div className="screen-scroll set-page acc-screen">
      <div className="acc-avatar-block">
        <button type="button" className="acc-avatar" aria-label={t("profile.edit.changeAvatar")} onClick={() => fileInput.current?.click()}>
          <span className="acc-avatar-img">{hasAvatar ? <img src={avatarPreview} alt="" /> : <Icon name="user" size={44} />}</span>
          <span className="acc-avatar-badge">
            <Icon name="camera" size={18} />
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          hidden
          onChange={(e) => {
            void pickAvatar(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="acc-avatar-links">
          <button type="button" onClick={() => fileInput.current?.click()}>
            {t("profile.edit.changeAvatar")}
          </button>
          {hasAvatar && (
            <button type="button" className="is-danger" onClick={dropAvatar}>
              {t("profile.edit.removeAvatar")}
            </button>
          )}
        </div>
      </div>

      <section className="set-group">
        <div className="set-group-title">{t("profile.edit.username")}</div>
        <ListField value={form.username} placeholder={t("profile.edit.username")} onChange={(v) => update({ username: v })} />
        <ListField type="email" value={form.email} placeholder={t("profile.edit.email")} onChange={(v) => update({ email: v })} />
      </section>

      <section className="set-group">
        <ListField multiline value={form.about} placeholder={t("profile.edit.about")} onChange={(v) => update({ about: v })} />
      </section>
      <ListHint>{t("settings.account.aboutHint")}</ListHint>

      <section className="set-group">
        <div className="set-group-title">{t("profile.edit.favoriteTags")}</div>
        <ListField value={form.favorite_tags} placeholder="tag1, tag2, ..." onChange={(v) => update({ favorite_tags: v })} />
      </section>
      <ListHint>{t("settings.account.tagsHint")}</ListHint>

      <section className="set-group">
        <div className="set-group-title">{t("settings.account.security")}</div>
        <button type="button" className="set-row" onClick={() => setShowBlacklist((v) => !v)}>
          <TileIcon icon="shield" color="#e5484d" />
          <span className="set-row-text">
            <span className="set-row-title">{t("profile.edit.blacklist")}</span>
            <span className="set-row-sub">{t("settings.account.blacklistSub")}</span>
          </span>
          <span className="set-row-trail">
            <Icon name={showBlacklist ? "chevron-up" : "chevron-down"} size={18} />
          </span>
        </button>

        {showBlacklist && (
          <div className="pe-section acc-expand">
            {blLoading ? (
              <div className="pe-bl-loading">
                <Spinner size={16} />
                {t("common.loading")}
              </div>
            ) : blError ? (
              <button
                type="button"
                className="pe-bl-retry"
                onClick={() => {
                  blLoaded.current = false;
                  setBlError(false);
                  setBlTags([]);
                }}
              >
                {t("common.retry")}
              </button>
            ) : null}

            <div className="pe-bl-results">
              {blSuggestLoading ? (
                <div className="pe-bl-skeletons">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} />
                  ))}
                </div>
              ) : visibleSuggest.length === 0 ? (
                <p className="pe-bl-hint">{blQuery.trim() ? t("common.nothingFound") : t("profile.blacklist.addPlaceholder")}</p>
              ) : (
                visibleSuggest.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className="pe-bl-suggest"
                    onClick={() => {
                      setBlTags((prev) => (prev.some((x) => x.id === it.id) ? prev : [...prev, it]));
                      setBlQuery("");
                      // Выбранный убираем сразу, список по умолчанию обновляем в фоне
                      setBlSuggest((prev) => prev.filter((x) => x.id !== it.id));
                      setTimeout(() => void runSuggest("", blType, true), 0);
                    }}
                  >
                    <span>
                      <b>{it.name}</b>
                      <small>
                        {String(it.type).toUpperCase()}  {it.count ?? 0}
                      </small>
                    </span>
                    <Icon name="plus" size={18} />
                  </button>
                ))
              )}
            </div>

            <div className="pe-bl-controls">
              <div className="pe-bl-type">
                <Select
                  value={blType}
                  options={BLACKLIST_TYPES}
                  onChange={(v) => {
                    setBlType(v as TagType);
                    setBlSuggest([]);
                  }}
                />
              </div>
              <input
                className="pe-bl-input"
                value={blQuery}
                disabled={blLoading}
                placeholder={t("profile.blacklist.addPlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setBlQuery(e.target.value)}
              />
            </div>

            {blTags.length === 0 ? (
              <p className="pe-bl-hint">{t("profile.blacklist.empty")}</p>
            ) : (
              <div className="pe-bl-chips">
                {blTags.map((it) => (
                  <button key={it.id} type="button" onClick={() => setBlTags((prev) => prev.filter((x) => x.id !== it.id))}>
                    <span>
                      <b>{it.name}</b>
                      <small>{String(it.type).toUpperCase()}</small>
                    </span>
                    <Icon name="x" size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button type="button" className="set-row" onClick={() => setShowPasswords((v) => !v)}>
          <TileIcon icon="key" color="#3fb950" />
          <span className="set-row-text">
            <span className="set-row-title">{t("profile.edit.changePassword")}</span>
            <span className="set-row-sub">{t("settings.account.passwordSub")}</span>
          </span>
          <span className="set-row-trail">
            <Icon name={showPasswords ? "chevron-up" : "chevron-down"} size={18} />
          </span>
        </button>
        {showPasswords && (
          <div className="acc-expand">
            <ListField type="password" value={form.old_password} placeholder={t("profile.edit.oldPassword")} onChange={(v) => update({ old_password: v })} />
            <ListField type="password" value={form.new_password1} placeholder={t("profile.edit.newPassword")} onChange={(v) => update({ new_password1: v })} />
            <ListField
              type="password"
              value={form.new_password2}
              placeholder={t("profile.edit.newPasswordAgain")}
              onChange={(v) => update({ new_password2: v })}
            />
          </div>
        )}
      </section>

      <section className="set-group">
        <button type="button" className="set-row set-row-danger" onClick={() => void signOut().then(() => navigate("/settings", { replace: true }))}>
          <TileIcon icon="log-out" color="#e5484d" />
          <span className="set-row-text">
            <span className="set-row-title">{t("menu.logout")}</span>
          </span>
        </button>
      </section>

      {isDirty && (
        <button type="button" className="pe-save" disabled={saving} onClick={() => void submit()}>
          {saving ? <Spinner size={16} /> : <Icon name="check" size={18} />}
          {t("common.save")}
        </button>
      )}
    </div>
  );
}
