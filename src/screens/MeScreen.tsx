/**
 * Вкладка «Профиль» нижней панели — новый кит. Заменяет боковое меню (`components/SideMenu` старого):
 * карточка аккаунта (или вход), «Мне повезёт», настройки и Discord. Библиотека — на главной (вкладка «Моя»). Выход — в карточке аккаунта.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRandomGalleryId } from "../api/galleries";
import { initCdn } from "../api/media";
import { avatarUrl } from "../components/CommentCard";
import { ListRow } from "../components/LibraryList";
import { useI18n } from "../i18n/I18nContext";
import { ownProfileRoute, signOut, useMe } from "../lib/session";
import { LoginModal } from "../shell/LoginModal";
import { Icon, Spinner } from "../ui";

const DISCORD_URL = "https://discord.gg/VnxH7yfPqf";

export function MeScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const me = useMe();
  const [loginOpen, setLoginOpen] = useState(false);

  const profileRoute = ownProfileRoute(me);

  return (
    <div className="screen-scroll ax-me">
      <section className="ax-card ax-me-account">
        {me ? (
          <>
            <button type="button" className="ax-me-user" onClick={() => navigate(profileRoute)}>
              <span className="ax-me-avatar">{me.avatar_url ? <img src={avatarUrl(me.avatar_url)} alt="" /> : <Icon name="user" size={28} />}</span>
              <span className="ax-me-text">
                <span className="ax-me-name">{me.username}</span>
                <span className="ax-me-sub">{t("nav.openProfile")}</span>
              </span>
              <Icon name="chevron-right" size={18} />
            </button>
            <button type="button" className="ax-btn ax-btn-ghost" onClick={() => void signOut()}>
              <Icon name="log-out" size={18} />
              {t("menu.logout")}
            </button>
          </>
        ) : (
          <>
            <div className="ax-me-user is-static">
              <span className="ax-me-avatar">
                <Icon name="user" size={28} />
              </span>
              <span className="ax-me-text">
                <span className="ax-me-name">{t("nav.guest")}</span>
                <span className="ax-me-sub">{t("nav.guestHint")}</span>
              </span>
            </div>
            <button type="button" className="ax-btn ax-btn-primary" onClick={() => setLoginOpen(true)}>
              <Icon name="log-in" size={18} />
              {t("menu.login")}
            </button>
          </>
        )}
      </section>

      <MeLinks />

      <LoginModal visible={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

/**
 * Список под карточкой аккаунта: «Мне повезёт», Discord и (на своём профиле) выход.
 * Нужен и гостю (`/me`), и на своей странице профиля — вкладка «Профиль» после входа открывает её.
 */
export function MeLinks({ withLogout = false }: { withLogout?: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [randomBusy, setRandomBusy] = useState(false);

  const goRandom = async () => {
    if (randomBusy) return;
    setRandomBusy(true);
    try {
      await initCdn();
      navigate(`/book/${await getRandomGalleryId()}?random=1`);
    } catch {
      /* как в старом меню — молча */
    } finally {
      setRandomBusy(false);
    }
  };

  return (
    <section className="ax-card ax-list-card">
      <ListRow icon="shuffle" label={t("menu.random")} onPress={() => void goRandom()} trailing={randomBusy ? <Spinner size={18} /> : undefined} />
      <ListRow
        icon="message-circle"
        label={t("menu.discordJoin")}
        onPress={() => window.open(DISCORD_URL, "_blank", "noopener")}
        trailing={<Icon name="arrow-up-right" size={16} />}
      />
      {withLogout && <ListRow icon="log-out" label={t("menu.logout")} onPress={() => void signOut()} />}
    </section>
  );
}
