/**
 * Поле нового комментария — перенос `components/CommentComposer.tsx`.
 * Отправка не раньше 10 символов. Порядок как в старом: капча → задача PoW `comment` → POST.
 * Капча открывается отдельным окном (`requestCaptcha`: Android — диалог, ПК — окно nhentai.net); статус пишется под полем.
 */
import { useState } from "react";
import { ApiError } from "../api/client";
import { postComment } from "../api/comments";
import { getCaptchaInfo, getPowChallenge, solvePoW } from "../api/config";
import type { Comment } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import { captchaSupported, requestCaptcha, useMe } from "../lib/session";
import { Icon, Spinner } from "../ui";

const MIN_LENGTH = 10;

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as { detail?: unknown; message?: unknown; error?: unknown } | null | undefined;
    const msg = body?.detail ?? body?.message ?? body?.error ?? e.message;
    return typeof msg === "string" ? msg : JSON.stringify(msg);
  }
  return e instanceof Error ? e.message : String(e);
}

export function CommentComposer({ galleryId, onSubmitted }: { galleryId: number; onSubmitted?: (c: Comment) => void }) {
  const { t } = useI18n();
  const me = useMe();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const length = value.trim().length;
  const canSend = !busy && length >= MIN_LENGTH;

  const send = async () => {
    if (!canSend) return;
    const body = value;
    setBusy(true);
    setError(null);
    try {
      if (!captchaSupported()) throw new Error(t("login.form.captchaAndroidOnly"));
      const info = await getCaptchaInfo();
      if (!info.site_key) throw new Error(t("commentComposer.error.captchaUnavailable"));
      setStatus(t("commentComposer.status.captcha"));
      const token = await requestCaptcha(info.site_key, info.provider || "turnstile", {
        title: t("commentComposer.captcha.title"),
        error: t("login.form.captchaFailed"),
        retry: t("common.retry"),
        cancel: t("common.cancel"),
      });
      if (!token) return; // окно закрыли — текст остаётся

      setStatus(t("commentComposer.status.pow"));
      const ch = await getPowChallenge("comment");
      const nonce = await solvePoW(ch.challenge, ch.difficulty);

      setStatus(t("commentComposer.status.posting"));
      const comment = await postComment(galleryId, {
        body,
        pow_challenge: ch.challenge,
        pow_nonce: nonce,
        captcha_response: token,
      });
      setValue("");
      // Сервер иногда отдаёт автора без аватара — дополняем своим профилем
      const poster = comment.poster;
      onSubmitted?.({
        ...comment,
        poster: {
          id: poster?.id ?? me?.id ?? 0,
          username: poster?.username || me?.username || "",
          slug: poster?.slug || me?.slug || "",
          avatar_url: poster?.avatar_url || me?.avatar_url || "",
          is_staff: poster?.is_staff ?? false,
          is_superuser: poster?.is_superuser ?? false,
        },
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          rows={1}
          value={value}
          disabled={busy}
          placeholder={t("commentComposer.placeholder")}
          onChange={(e) => {
            setValue(e.target.value);
            // Поле растёт с текстом до max-height из стилей
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
        />
        <button type="button" disabled={!canSend} aria-label={t("commentComposer.placeholder")} onClick={() => void send()}>
          {busy ? <Spinner size={20} /> : <Icon name="send" size={20} />}
        </button>
      </div>
      <p className="composer-hint">
        {status ||
          (length < MIN_LENGTH ? t("commentComposer.hint.needMore", { n: MIN_LENGTH - length }) : t("commentComposer.hint.captcha"))}
      </p>
      {error && <p className="composer-hint is-error">{error}</p>}
    </div>
  );
}
