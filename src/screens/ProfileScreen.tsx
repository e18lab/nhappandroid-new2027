/**
 * Публичный профиль nhentai — перенос `app/profile/[id]/[slug].tsx` (релиз 1.3.1).
 * Вид нового кита: сверху размытый аватар-фон, крупный аватар, имя, ID и дата регистрации, «Редактировать»
 * (свой профиль — открывает Настройки → Аккаунт). Ниже карточки-группы: «о себе», любимые теги,
 * последние избранные — каруселью карточек того вида, что выбран в настройках, последние комментарии со ссылкой на книгу.
 *
 * Баннер в старом окрашивался в основной цвет аватара (react-native-image-colors); аватар лежит на
 * CDN без CORS, пиксели из страницы не прочитать — вместо цвета показываем размытый аватар.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { getUserProfile } from "../api/account";
import { galleryRelatedToBook, type Book } from "../api/book";
import { initCdn } from "../api/media";
import type { UserProfile } from "../api/types";
import { BookCarousel } from "../components/BookCollection";
import { avatarUrl, CommentCard } from "../components/CommentCard";
import { useI18n, type ResolvedLocale } from "../i18n/I18nContext";
import { useMe } from "../lib/session";
import { Icon, ListGroup, LoadingSpinner } from "../ui";

function decodeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/** «Зарегистрирован: 2 года 3 месяца назад» — formatJoinedAgo из старого. */
function joinedAgo(lang: ResolvedLocale, joinedSec: number): string {
  const joined = new Date(joinedSec * 1000);
  const now = new Date();
  let total = (now.getFullYear() - joined.getFullYear()) * 12 + now.getMonth() - joined.getMonth();
  if (now.getDate() < joined.getDate()) total--;
  total = Math.max(0, total);
  const years = Math.floor(total / 12);
  const months = total % 12;
  if (!years && !months) {
    return { ru: "Зарегистрирован недавно", ja: "登録したばかり", zh: "刚注册", en: "Just joined" }[lang];
  }
  if (lang === "ru") {
    const y = years ? `${years} ${pluralRu(years, "год", "года", "лет")}` : "";
    const m = months ? `${months} ${pluralRu(months, "месяц", "месяца", "месяцев")}` : "";
    return `Зарегистрирован: ${[y, m].filter(Boolean).join(" ")} назад`;
  }
  if (lang === "ja") return `登録してから${years ? `${years}年` : ""}${months ? `${months}か月` : ""}`;
  if (lang === "zh") return `注册已有${years ? `${years}年` : ""}${months ? `${months}个月` : ""}`;
  const y = years ? `${years} year${years !== 1 ? "s" : ""}` : "";
  const m = months ? `${months} month${months !== 1 ? "s" : ""}` : "";
  return `Joined: ${[y, m].filter(Boolean).join(" ")} ago`;
}

export function ProfileScreen() {
  const { t, resolved } = useI18n();
  const navigate = useNavigate();
  const { id, slug = "" } = useParams();
  const me = useMe();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [busy, setBusy] = useState(true);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    (async () => {
      await initCdn();
      const p = await getUserProfile(Number(id), slug).catch(() => null);
      if (!alive) return;
      setProfile(p);
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [id, slug]);

  const recent = useMemo<Book[]>(
    () => (profile?.recent_favorites ?? []).slice(0, 12).map((f) => galleryRelatedToBook({ ...f, tag_ids: [] })),
    [profile],
  );

  if (busy && !profile) return <LoadingSpinner />;
  if (!profile) {
    return (
      <div className="screen-fill fo-empty">
        <Icon name="user" size={40} />
        <p>{t("common.nothingFound")}</p>
      </div>
    );
  }

  const avatar = avatarUrl(profile.avatar_url);
  const about = profile.about ? decodeHtml(profile.about).trim() : "";
  const tags = profile.favorite_tags
    ? decodeHtml(profile.favorite_tags)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const canEdit = !!me && me.id === profile.id;
  const comments = (profile.recent_comments ?? []).slice(0, 20);
  const openBook = (b: Book) => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`);

  return (
    <div className="screen-scroll set-page pf-screen">
      <header className="pf-hero">
        <div className="pf-banner" aria-hidden>
          {avatar && <img src={avatar} alt="" />}
        </div>
        <button type="button" className="pf-avatar" onClick={() => avatar && setPreview(true)}>
          {avatar ? <img src={avatar} alt="" /> : <Icon name="user" size={44} />}
        </button>
        <h1 className="pf-name">{profile.username || "user"}</h1>
        <div className="pf-sub">
          <span>ID {profile.id}</span>
          {!!profile.date_joined && <span>{joinedAgo(resolved, profile.date_joined)}</span>}
        </div>
        {canEdit && (
          <button type="button" className="pf-edit" onClick={() => navigate("/settings/account")}>
            <Icon name="edit-2" size={16} />
            {t("profile.edit.button")}
          </button>
        )}
      </header>

      {about && (
        <ListGroup title={t("profile.edit.about")}>
          <p className="pf-about">{about}</p>
        </ListGroup>
      )}

      {tags.length > 0 && (
        <ListGroup title={t("profile.edit.favoriteTags")}>
          <div className="pf-tags">
            {tags.slice(0, 36).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </ListGroup>
      )}

      <ListGroup title={t("menu.favorites")}>
        {recent.length === 0 ? (
          <p className="pf-empty">{t("historyNotFound")}</p>
        ) : (
          <div className="pf-favs">
            <BookCarousel books={recent} onPress={openBook} />
          </div>
        )}
      </ListGroup>

      {comments.length > 0 && (
        <ListGroup title={t("comments.title")}>
          <div className="pf-comments">
            {comments.map((c) => (
              <CommentCard
                key={c.id}
                comment={{
                  id: c.id,
                  gallery_id: c.gallery_id,
                  body: c.body,
                  post_date: c.post_date,
                  poster: {
                    id: profile.id,
                    username: profile.username,
                    slug: profile.slug,
                    avatar_url: profile.avatar_url,
                    is_staff: profile.is_staff,
                    is_superuser: profile.is_superuser,
                  },
                }}
                bookTitle={decodeHtml(c.gallery_title || `#${c.gallery_id}`)}
                onPressBook={() => navigate(`/book/${c.gallery_id}?title=${encodeURIComponent(decodeHtml(c.gallery_title || ""))}`)}
              />
            ))}
          </div>
        </ListGroup>
      )}

      {preview && avatar && <AvatarViewer src={avatar} onClose={() => setPreview(false)} />}
    </div>
  );
}

/**
 * Аватар целиком: затемнение с размытием на весь экран, по центру картинка со скруглением (не больше
 * 512px), появляется с увеличением. Закрывается нажатием в любое место или Esc.
 */
function AvatarViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => setClosing(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setClosing(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div
      className={closing ? "pf-viewer is-closing" : "pf-viewer"}
      role="dialog"
      onClick={close}
      onAnimationEnd={(e) => closing && e.target === e.currentTarget && onClose()}
    >
      <img src={src} alt="" />
    </div>,
    document.body,
  );
}
