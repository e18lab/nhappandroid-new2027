/**
 * Публичный профиль nhentai — перенос `app/profile/[id]/[slug].tsx` (релиз 1.3.1).
 * Слева (на телефоне — сверху): баннер, аватар, имя, ID, «о себе», дата регистрации, любимые теги.
 * Справа: последние избранные книги лентой и последние комментарии со ссылкой на книгу.
 *
 * Баннер в старом окрашивался в основной цвет аватара (react-native-image-colors); аватар лежит на
 * CDN без CORS, пиксели из страницы не прочитать — вместо цвета показываем размытый аватар.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getUserProfile } from "../api/account";
import { galleryRelatedToBook, type Book } from "../api/book";
import { initCdn } from "../api/media";
import type { UserProfile } from "../api/types";
import { BookCard } from "../components/BookCard";
import { avatarUrl, CommentCard } from "../components/CommentCard";
import { useI18n, type ResolvedLocale } from "../i18n/I18nContext";
import { useEnrichedBooks } from "../lib/bookEnrich";
import { useMe } from "../lib/session";
import { Icon, LoadingSpinner, NhModal } from "../ui";
import { MeLinks } from "./MeScreen";

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
  const favRow = useRef<HTMLDivElement>(null);

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
  const recentBooks = useEnrichedBooks(recent);

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
  const scrollFavs = (dx: number) => favRow.current?.scrollBy({ left: dx, behavior: "smooth" });

  return (
    <div className="screen-scroll profile-screen">
      <div className="profile-layout">
        <section className="profile-panel">
          <div className="profile-banner">{avatar && <img src={avatar} alt="" aria-hidden />}</div>
          <div className="profile-head">
            <button type="button" className="profile-avatar" onClick={() => avatar && setPreview(true)}>
              {avatar ? <img src={avatar} alt="" /> : <Icon name="user" size={48} />}
            </button>
            <div className="profile-name">{profile.username || "user"}</div>
            <div className="profile-sub">ID: {profile.id}</div>
            {canEdit && (
              <button
                type="button"
                className="profile-edit"
                onClick={() => navigate(`/profile/${profile.id}/${encodeURIComponent(profile.slug || slug)}/edit`)}
              >
                {t("profile.edit.button")}
              </button>
            )}
            {about && <p className="profile-about">{about}</p>}
            {!!profile.date_joined && <p className="profile-joined">📅 {joinedAgo(resolved, profile.date_joined)}</p>}
            {tags.length > 0 && (
              <>
                <div className="profile-subheader">{t("tags.tags")}</div>
                <div className="profile-tags">
                  {tags.slice(0, 36).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="profile-panel profile-right">
          <div className="profile-section-head">
            <span className="profile-section-title">{t("menu.favorites")}</span>
            {recent.length > 0 && (
              <span className="profile-arrows">
                <button type="button" aria-label={t("common.back")} onClick={() => scrollFavs(-220)}>
                  <Icon name="chevron-left" size={22} />
                </button>
                <button type="button" aria-label={t("common.nextPage")} onClick={() => scrollFavs(220)}>
                  <Icon name="chevron-right" size={22} />
                </button>
              </span>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="profile-empty">{t("historyNotFound")}</p>
          ) : (
            <div ref={favRow} className="profile-favs">
              {recentBooks.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  cardWidth={160}
                  onPress={() => navigate(`/book/${b.id}?title=${encodeURIComponent(b.title.pretty)}`)}
                />
              ))}
            </div>
          )}

          <div className="profile-section-head">
            <span className="profile-section-title">{t("comments.title")}</span>
          </div>
          <div className="profile-comments">
            {(profile.recent_comments ?? []).slice(0, 20).map((c) => (
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
        </section>
      </div>

      {canEdit && (
        <div className="ax-me profile-own-links">
          <MeLinks withLogout />
        </div>
      )}

      <NhModal visible={preview} onClose={() => setPreview(false)}>
        <img className="profile-avatar-preview" src={avatar} alt="" />
      </NhModal>
    </div>
  );
}
