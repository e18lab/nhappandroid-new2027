/**
 * Боковое меню — перенос `components/SideMenu/index.tsx` (ветка master / релиз 1.3.1).
 * Отступы и размеры — TOKENS старого: padX 12, padY 8, радиус 12, иконка 20, пункт ≥44px, зазор 6.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getRandomGalleryId } from "../api/galleries";
import { avatarUrl } from "../components/CommentCard";
import { initCdn } from "../api/media";
import { signOut, useMe } from "../lib/session";
import { useI18n } from "../i18n/I18nContext";
import { CardPressable, Icon, IconBtn, Section, Spinner, type IconName } from "../ui";
import { LoginModal } from "./LoginModal";

const DISCORD_URL = "https://discord.gg/VnxH7yfPqf";
const PARTICLE_COUNT = 8;
/** Бейдж «НОВОЕ» у рекомендаций показывался до этой даты. */
const NEW_BADGE_UNTIL_MS = Date.parse("2026-05-01T00:00:00.000Z");

/** Как LIBRARY_MENU в старом `constants/Menu.ts`. */
const LIBRARY_MENU: { labelKey: string; icon: IconName; route: string }[] = [
  { labelKey: "menu.downloaded", icon: "download", route: "/downloaded" },
  { labelKey: "menu.favorites", icon: "bookmark", route: "/favorites" },
  { labelKey: "menu.favoritesOnline", icon: "heart", route: "/favorites-online" },
  { labelKey: "menu.history", icon: "clock", route: "/history" },
  { labelKey: "menu.characters", icon: "package", route: "/characters" },
  { labelKey: "menu.recommendations", icon: "star", route: "/recommendations" },
  { labelKey: "menu.settings", icon: "settings", route: "/settings" },
];

export function SideMenu({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const me = useMe();
  const loggedIn = !!me;
  const [loginOpen, setLoginOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [randomLoading, setRandomLoading] = useState(false);

  const goTo = (route: string) => {
    onClose();
    navigate(route);
  };

  const goRandom = async () => {
    if (randomLoading) return;
    setRandomLoading(true);
    try {
      await initCdn();
      const id = await getRandomGalleryId();
      onClose();
      navigate(`/book/${id}?random=1`);
    } catch {
      /* как в старом — молча */
    } finally {
      setRandomLoading(false);
    }
  };

  return (
    <div className="side-menu">
      <div className="side-menu-scroll">
        <div className="side-menu-header">
          <span className="side-menu-logo">
            <Icon name="book-open" size={18} />
          </span>
          <span>
            <span className="side-menu-brand">{t("menu.brand")}</span>
            <span className="side-menu-tag">{t("menu.brandTag")}</span>
          </span>
        </div>

        <Section title={t("menu.section.library")} dense dividerColor="color-mix(in srgb, var(--sub) 20%, transparent)" style={{ margin: "3px 0" }} />

        <div className="side-menu-list">
          {LIBRARY_MENU.map((item) => {
            const active = pathname.startsWith(item.route);
            const disabled = !loggedIn && item.route === "/favorites-online";
            const showNew = Date.now() < NEW_BADGE_UNTIL_MS && item.route === "/recommendations";
            return (
              <CardPressable
                key={item.route}
                radius={12}
                pressedScale={0.98}
                overlayColor="color-mix(in srgb, var(--sub) 6%, transparent)"
                disabled={disabled}
                accessibilityLabel={t(item.labelKey)}
                onPress={() => goTo(item.route)}
                className={`side-menu-item${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
              >
                <span className="side-menu-item-icon">
                  <Icon name={item.icon} size={20} />
                </span>
                <span className="side-menu-item-label">{t(item.labelKey)}</span>
                {showNew && <span className="side-menu-new">{t("menu.new")}</span>}
                {disabled ? <Icon name="lock" size={14} className="ui-muted" /> : <Icon name="chevron-right" size={18} />}
              </CardPressable>
            );
          })}
        </div>

        <CardPressable
          radius={12}
          overlayColor="transparent"
          pressedScale={0.97}
          disabled={randomLoading}
          accessibilityLabel={t("menu.random")}
          onPress={goRandom}
          className="side-menu-random"
        >
          {randomLoading ? <Spinner size={18} /> : <Icon name="shuffle" size={20} />}
          <span>{t("menu.random").toUpperCase()}</span>
        </CardPressable>

        <div className="side-menu-divider" />

        <CardPressable
          radius={12}
          pressedScale={0.98}
          overlayColor="color-mix(in srgb, var(--sub) 6%, transparent)"
          onPress={() => {
            onClose();
            window.open(DISCORD_URL, "_blank", "noopener");
          }}
          className="side-menu-discord"
        >
          <DiscordParticles />
          <span className="side-menu-item-icon">
            <Icon name="message-circle" size={20} />
          </span>
          <span className="side-menu-discord-text">
            <span className="side-menu-discord-title">{t("menu.discordJoin")}</span>
            <span className="side-menu-discord-sub">{t("menu.discordSubtitle")}</span>
          </span>
          <Icon name="arrow-up-right" size={14} />
        </CardPressable>
        <div style={{ height: 8 }} />
      </div>

      <div className="side-menu-footer">
        {me ? (
          <CardPressable
            radius={16}
            pressedScale={0.99}
            overlayColor="color-mix(in srgb, var(--sub) 6%, transparent)"
            accessibilityLabel={t("menu.profile")}
            onPress={() => goTo(`/profile/${me.id}/${encodeURIComponent((me.slug || me.username || String(me.id)).toLowerCase())}`)}
            className="side-menu-me"
          >
            {me.avatar_url ? (
              <img className="side-menu-avatar" src={avatarUrl(me.avatar_url)} alt="" />
            ) : (
              <span className="side-menu-avatar">
                <Icon name="user" size={18} />
              </span>
            )}
            <span className="side-menu-me-text">
              <span className="side-menu-me-name">{me.username}</span>
              <span className="side-menu-me-sub">{t("menu.profile")}</span>
            </span>
            <span className="side-menu-logout" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
              <IconBtn size={36} shape="circle" accessibilityLabel={t("menu.logout")} onPress={() => void signOut()}>
                <Icon name="log-out" size={18} />
              </IconBtn>
            </span>
          </CardPressable>
        ) : (
          <CardPressable
            radius={16}
            pressedScale={0.98}
            overlayColor="color-mix(in srgb, var(--sub) 6%, transparent)"
            accessibilityLabel={t("menu.login")}
            onPress={() => setLoginOpen(true)}
            className="side-menu-login"
          >
            <Icon name="log-in" size={20} />
            <span>{t("menu.login")}</span>
          </CardPressable>
        )}
      </div>
      <LoginModal visible={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Звёздочки, разлетающиеся по кнопке Discord, — как частицы в старом меню. */
function DiscordParticles() {
  const host = useRef<HTMLSpanElement>(null);
  const [seeds, setSeeds] = useState<CSSProperties[]>([]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    const base = Math.min(width, height);
    setSeeds(
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = rand(0, Math.PI * 2);
        const distance = rand(base * 0.25, base * 0.7);
        return {
          left: rand(width * 0.1, width * 0.9),
          top: rand(height * 0.2, height * 0.8),
          "--dx": `${Math.cos(angle) * distance}px`,
          "--dy": `${Math.sin(angle) * distance}px`,
          "--s0": rand(0.5, 0.9),
          "--s1": rand(1.1, 1.6),
          animationDuration: `${rand(900, 1500)}ms`,
          animationDelay: `${rand(0, 900)}ms`,
          opacity: 0,
          color: `color-mix(in srgb, var(--accent) ${[100, 80, 67][i % 3]}%, transparent)`,
          fontSize: 6 + ((i * 2) % 6),
        } as CSSProperties;
      }),
    );
  }, []);

  return (
    <span ref={host} className="discord-particles" aria-hidden="true">
      {seeds.map((style, i) => (
        <span key={i} className="discord-particle" style={style}>
          <Icon name="star" size={Number(style.fontSize)} />
        </span>
      ))}
    </span>
  );
}
