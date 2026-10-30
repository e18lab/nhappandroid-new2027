/**
 * Комментарий — перенос `components/CommentCard.tsx`: аватар, имя, «… назад», текст,
 * кнопка перевода (если язык текста не совпадает с языком интерфейса).
 * Долгое нажатие — меню: перевести / показать оригинал, скопировать, удалить (только свой).
 */
import { useEffect, useState } from "react";
import type { Comment } from "../api/types";
import { useI18n } from "../i18n/I18nContext";
import { timeAgo } from "../lib/timeAgo";
import { detectLanguage, targetLanguage, translateText } from "../lib/translate";
import { Icon, NhModal, Spinner, useLongPress, useToast } from "../ui";

/** Аватары приходят относительным путём — они лежат на CDN картинок. */
export function avatarUrl(u?: string | null): string {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//.test(s)) return s;
  if (s.startsWith("//")) return "https:" + s;
  return "https://i1.nhentai.net" + (s.startsWith("/") ? s : "/" + s);
}

interface Props {
  comment: Comment;
  mine?: boolean;
  onDelete?: (id: number) => Promise<void>;
  /** Ссылка на книгу под текстом (комментарии в профиле). */
  bookTitle?: string;
  onPressBook?: () => void;
  /** Нажатие на аватар или имя — профиль автора. */
  onPressPoster?: () => void;
}

export function CommentCard({ comment, mine, onDelete, bookTitle, onPressBook, onPressPoster }: Props) {
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const longPress = useLongPress(() => setMenuOpen(true));

  const body = comment.body ?? "";
  useEffect(() => {
    setTranslated(null);
    setShowOriginal(false);
  }, [body]);

  const target = targetLanguage(resolved);
  const canTranslate = body.trim().length > 2 && detectLanguage(body) !== target;
  const displayBody = translated && !showOriginal ? translated : body;
  const time = comment.post_date ? timeAgo(comment.post_date, resolved) : "";
  const avatar = avatarUrl(comment.poster?.avatar_url);
  const name = comment.poster?.username || "user";

  const translate = async () => {
    setMenuOpen(false);
    if (translated) return setShowOriginal((v) => !v);
    setBusy(true);
    try {
      setTranslated(await translateText(body, target));
      setShowOriginal(false);
    } catch {
      showToast({ type: "error", title: t("comments.error.title"), message: t("comments.error.translate") });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(displayBody);
      showToast({ title: t("comments.copied") });
    } catch {
      /* буфер недоступен */
    }
  };

  const confirmDelete = async () => {
    if (!onDelete) return;
    setDeleteBusy(true);
    try {
      await onDelete(comment.id);
      setDeleteOpen(false);
    } catch {
      showToast({ type: "error", title: t("comments.error.title"), message: t("comments.error.delete") });
    } finally {
      setDeleteBusy(false);
    }
  };

  const translateLabel = translated
    ? showOriginal
      ? t("comments.menu.showTranslation")
      : t("comments.menu.showOriginal")
    : t("comments.menu.translate");

  const head = (
    <div className="comment-head">
      {onPressPoster ? (
        <button type="button" className="comment-name" onClick={onPressPoster}>
          {name}
        </button>
      ) : (
        <span className="comment-name">{name}</span>
      )}
      {time && (
        <>
          <span className="comment-dot">·</span>
          <span className="comment-time">{time}</span>
        </>
      )}
    </div>
  );

  return (
    <>
      <div
        className={mine ? "comment is-mine" : "comment"}
        onPointerDown={longPress.start}
        onPointerUp={longPress.cancel}
        onPointerLeave={longPress.cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        {onPressPoster ? (
          <button type="button" className="comment-avatar-btn" onClick={onPressPoster}>
            {avatar ? <img className="comment-avatar" src={avatar} alt="" loading="lazy" /> : <span className="comment-avatar" />}
          </button>
        ) : avatar ? (
          <img className="comment-avatar" src={avatar} alt="" loading="lazy" />
        ) : (
          <span className="comment-avatar" />
        )}
        <div className="comment-content">
          {head}
          <p className="comment-body">{displayBody}</p>
          {(canTranslate || translated || (bookTitle && onPressBook)) && (
            <div className="comment-footer">
              {(canTranslate || translated) && (
                <button type="button" className="comment-translate" disabled={busy} onClick={() => void translate()}>
                  {busy ? <Spinner size={13} /> : <Icon name="globe" size={13} />}
                  {busy ? "…" : translateLabel}
                </button>
              )}
              {bookTitle && onPressBook && (
                <button type="button" className="comment-book" onClick={onPressBook}>
                  <Icon name="book-open" size={13} />
                  <span>{bookTitle}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <NhModal visible={menuOpen} onClose={() => setMenuOpen(false)} title={name}>
        <div className="comment-menu">
          {(canTranslate || translated) && (
            <button type="button" disabled={busy} onClick={() => void translate()}>
              <Icon name="globe" size={18} />
              {translateLabel}
            </button>
          )}
          <button type="button" onClick={() => void copy()}>
            <Icon name="file-text" size={18} />
            {t("comments.menu.copy")}
          </button>
          {mine && onDelete && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
            >
              <Icon name="trash-2" size={18} />
              {t("comments.menu.delete")}
            </button>
          )}
        </div>
      </NhModal>

      <NhModal visible={deleteOpen} onClose={() => setDeleteOpen(false)} title={t("comments.delete.title")}>
        <div className="comment-delete">
          <div className="comment comment-preview">
            {avatar ? <img className="comment-avatar" src={avatar} alt="" /> : <span className="comment-avatar" />}
            <div className="comment-content">
              {head}
              <p className="comment-body">{displayBody}</p>
            </div>
          </div>
          <div className="comment-delete-actions">
            <button type="button" onClick={() => setDeleteOpen(false)}>
              {t("comments.delete.cancel")}
            </button>
            <button type="button" className="is-primary" disabled={deleteBusy} onClick={() => void confirmDelete()}>
              {deleteBusy ? <Spinner size={16} /> : t("comments.delete.confirm")}
            </button>
          </div>
        </div>
      </NhModal>
    </>
  );
}
