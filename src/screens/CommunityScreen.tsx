/**
 * «Сообщество» — то, что наполняют сами пользователи (данные с nappi, `api/community.ts`), в новом ките:
 *
 * «Персонажи» — карточки персонажей, вырезанные со страниц книг: постеры тайтлов (коллаж из карточек)
 * или все персонажи сразу, той же сеткой, что книги. По нажатию — шторка персонажа: все его карточки,
 * поиск книг с ним и с его тайтлом, книга-источник.
 *
 * «Перевод тегов» — режимы: «Теги» (прогресс по языкам, поиск, фильтры «без перевода / переведено»,
 * сортировка по популярности / имени / свежим правкам, типы с числом найденного), «Правки» (лента
 * последних правок, по нажатию на автора — только его) и для модераторов «Модерация» (баны, откат правок
 * пользователя, выгрузка CSV и отладка: время ответа сервера, возраст кеша). Тег правится в шторке:
 * все четыре языка сразу (перевод и описание — что тег значит) и история правок. «Файлы» — перевод файлом: скачать CSV с тегами (язык,
 * переведено или нет, типы, популярные сверху), перевести, загрузить с предпросмотром изменений и отправить
 * на рассмотрение; модератор принимает заявку целиком или выборочно (строки пишутся от имени автора).
 *
 * Защита от порчи — на сервере (личность по токену nhentai, лимит правок, блокировки, чужие переводы
 * удаляет только модератор). Модератору здесь: откат отдельной правки (в истории и ленте), откат всех
 * правок пользователя за период, бан (можно сразу с откатом), блокировка тега. С подтверждённым токеном
 * пароль админки не нужен.
 *
 * На телефоне — раздел нижней панели со своими вкладками, листаются свайпом. На ПК — вкладка главной
 * со стрелкой: страница выбирается в выпадающем меню (`useCommunityMenu`). Выбранная страница запоминается
 * (`ui.community.page`) и общая для обоих видов.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { pageSources } from "../api/media";
import {
  applyTranslationChunk,
  cachedCharacterCatalog,
  CommunityError,
  downloadTranslationFile,
  getCharacterCards,
  getCharacterCatalog,
  getCommunityMe,
  getEditorBans,
  getEditorSummary,
  getTagLocks,
  getRecentEdits,
  getSubmission,
  getSubmissions,
  getTagHistory,
  getTranslationStats,
  getTranslationTable,
  lastResponse,
  previewTranslationFile,
  reviewSubmission,
  revertEdit,
  rollbackEditor,
  ROLLBACK_PERIODS,
  saveDescription,
  saveTranslation,
  setEditorBan,
  setTagLock,
  submitTranslationFile,
  exportTranslationsCsv,
  TRANSLATION_LOCALES,
  TRANSLATION_TAG_TYPES,
  withdrawSubmission,
  type CardRect,
  type CharacterCard,
  type CharacterCatalogItem,
  type CommunityMe,
  type EditorBan,
  type EditorSummary,
  type FilePreview,
  type HistoryEntry,
  type PreviewRow,
  type PreviewStatus,
  type RollbackPeriod,
  type Submission,
  type SubmissionStatus,
  type TagLock,
  type TranslationLocale,
  type TranslationRow,
  type TranslationSort,
  type TranslationStats,
  type TranslationStatus,
  type TranslationTable,
  type TranslationTagType,
} from "../api/community";
import { useGridMetrics } from "../components/BookGrid";
import { API_BASE_URL } from "../config/api";
import { useI18n, type ResolvedLocale } from "../i18n/I18nContext";
import { inTauri } from "../lib/downloads";
import { useMe } from "../lib/session";
import { getItem, setItem, subscribe } from "../lib/storage";
import { setTagTranslation } from "../lib/tagTranslations";
import { timeAgo } from "../lib/timeAgo";
import { useBackHandler } from "../shell/androidBack";
import { openLogin } from "../shell/LoginModal";
import {
  Icon,
  ListGroup,
  ListHint,
  ListRow,
  LoadingSpinner,
  NhModal,
  NoResultsPanel,
  PageTabs,
  Pager,
  Spinner,
  TileIcon,
  usePager,
  useToast,
  type IconName,
  type TabMenu,
} from "../ui";

const PAGE_KEY = "ui.community.page";

export const COMMUNITY_PAGES: { key: string; labelKey: string; descKey: string; icon: IconName; render: () => ReactNode }[] = [
  { key: "characters", labelKey: "community.characters", descKey: "community.charactersSub", icon: "users", render: () => <CharactersPage /> },
  { key: "translations", labelKey: "community.translations", descKey: "community.translationsSub", icon: "language", render: () => <TranslationsPage /> },
];

function readPage(): string {
  const saved = getItem(PAGE_KEY);
  return COMMUNITY_PAGES.some((p) => p.key === saved) ? saved! : COMMUNITY_PAGES[0].key;
}

export function useCommunityPage(): [string, (key: string) => void] {
  const page = useSyncExternalStore((cb) => subscribe((key) => key === PAGE_KEY && cb()), readPage);
  return [page, (key) => setItem(PAGE_KEY, key)];
}

/** Меню вкладки «Сообщество» на ПК. */
export function useCommunityMenu(): TabMenu {
  const { t } = useI18n();
  const [page, setPage] = useCommunityPage();
  return {
    title: t("community.title"),
    items: COMMUNITY_PAGES.map((p) => ({ key: p.key, label: t(p.labelKey), description: t(p.descKey), icon: p.icon })),
    value: page,
    onSelect: setPage,
  };
}

/** ПК: выбранная в меню страница. */
export function CommunityPage() {
  const [page] = useCommunityPage();
  const current = COMMUNITY_PAGES.find((p) => p.key === page) ?? COMMUNITY_PAGES[0];
  return <div key={current.key} className="screen-fill">{current.render()}</div>;
}

/** Телефон: раздел нижней панели со своими вкладками. */
export function CommunityScreen() {
  const { t } = useI18n();
  const [page, setPage] = useCommunityPage();
  const pager = usePager(COMMUNITY_PAGES.length, COMMUNITY_PAGES.findIndex((p) => p.key === page));
  return (
    <div className="screen-fill ax-home">
      <div className="ax-home-tabs">
        <PageTabs pager={pager} tabs={COMMUNITY_PAGES.map((p) => ({ key: p.key, label: t(p.labelKey) }))} />
      </div>
      <Pager pager={pager} count={COMMUNITY_PAGES.length} onIndexChange={(i) => setPage(COMMUNITY_PAGES[i].key)} render={(i) => COMMUNITY_PAGES[i].render()} />
    </div>
  );
}

// ─── Общее ────────────────────────────────────────────────────────────────────

/** Сегменты-«пилюли» в стиле вкладок кита. */
function Segment<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="cm-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={o.key === value} className={o.key === value ? "is-active" : ""} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SearchPill({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { t } = useI18n();
  return (
    <label className="cm-search">
      <Icon name="search" size={18} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {!!value && (
        <button type="button" aria-label={t("common.reset")} onClick={() => onChange("")}>
          <Icon name="x" size={16} />
        </button>
      )}
    </label>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 1234 → «1.2K». */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Профиль nhentai: slug — ник в нижнем регистре (как у своего профиля в `ownProfileRoute`). */
const profileRoute = (id: number, name: string) => `/profile/${id}/${encodeURIComponent((/^user:\d+$|^#\d+$/.test(name) ? String(id) : name).toLowerCase())}`;

/** Запрос поиска книг по тегу в синтаксисе nhentai. */
const tagQuery = (type: string, name: string) => `${type}:"${name}"`;

const appLocale = (resolved: string): TranslationLocale => (TRANSLATION_LOCALES.includes(resolved as TranslationLocale) ? (resolved as TranslationLocale) : "en");

// ─── Персонажи ────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().trim();

type CharView = "parodies" | "all";

function CharactersPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<CharacterCatalogItem[] | null>(cachedCharacterCatalog);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<CharView>("parodies");
  // Открытый тайтл ("" — без тайтла), null — список тайтлов
  const [parody, setParody] = useState<string | null>(null);
  const [selected, setSelected] = useState<CharacterCatalogItem | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useGridMetrics();

  const load = useCallback(() => {
    setError(null);
    getCharacterCatalog().then(setItems, (e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  useBackHandler(parody != null && !selected, () => setParody(null));
  // Не возвращать результат: в новых Chromium scrollTo отдаёт Promise, React принял бы его за очистку
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [parody, view]);

  const groups = useMemo(() => {
    const map = new Map<string, CharacterCatalogItem[]>();
    for (const it of items ?? []) {
      const key = it.parodyName ?? "";
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(!!b.rect) - Number(!!a.rect) || a.characterName.localeCompare(b.characterName));
    }
    // Больше персонажей — выше; без тайтла — в конце
    return [...map.entries()].sort(([a, x], [b, y]) => (!a ? 1 : !b ? -1 : y.length - x.length || a.localeCompare(b)));
  }, [items]);

  const q = norm(query);
  const shown = useMemo(() => {
    const all = items ?? [];
    if (q) return all.filter((it) => norm(it.characterName).includes(q) || norm(it.parodyName ?? "").includes(q));
    if (parody != null) return groups.find(([key]) => key === parody)?.[1] ?? [];
    if (view === "all") return [...all].sort((a, b) => a.characterName.localeCompare(b.characterName));
    return null;
  }, [items, q, parody, view, groups]);

  const pad: CSSProperties = { paddingLeft: grid.pad, paddingRight: grid.pad };
  const gridStyle: CSSProperties = { ...pad, columnGap: grid.gap, gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` };

  let body: ReactNode;
  if (error && !items) {
    body = <NoResultsPanel iconName="alert-circle" title={t("community.error", { error })} actions={[{ label: t("common.retry"), onPress: load }]} />;
  } else if (!items) {
    body = <LoadingSpinner />;
  } else if (shown && !shown.length) {
    body = <p className="cm-empty">{q ? t("common.nothingFound") : t("community.empty")}</p>;
  } else if (shown) {
    body = (
      <div className="ax-posters" style={gridStyle}>
        {grid.ready && shown.map((it) => <CharacterPoster key={`${it.parodyName}|${it.characterName}`} item={it} onPress={() => setSelected(it)} />)}
      </div>
    );
  } else {
    body = (
      <div className="ax-posters" style={gridStyle}>
        {grid.ready &&
          groups.map(([key, list]) => (
            <div key={key} className="ax-poster" role="button" tabIndex={0} onClick={() => setParody(key)} onKeyDown={(e) => e.key === "Enter" && setParody(key)}>
              <div className={`ax-poster-cover cm-collage n${Math.min(list.length, 4)}`}>
                {list.slice(0, 4).map((it, i) => (
                  <CroppedImage key={i} url={it.imageUrl} rect={it.rect} />
                ))}
                <span className="ax-poster-badges">
                  <Icon name="users" size={14} />
                  {list.length}
                </span>
              </div>
              <h3 className="ax-poster-title cm-cap">{key || t("community.noParody")}</h3>
              <div className="ax-poster-sub">{t("community.charactersCount", { count: list.length })}</div>
            </div>
          ))}
      </div>
    );
  }

  return (
    <div ref={scroller} className="screen-scroll">
      <div ref={grid.host} className="cm-page">
        <div className="cm-head" style={pad}>
          {parody != null && !q ? (
            <div className="cm-title-row">
              <button type="button" className="ax-icon-btn" aria-label={t("common.back")} onClick={() => setParody(null)}>
                <Icon name="arrow-left" size={22} />
              </button>
              <div className="cm-title-text">
                <h2 className="cm-title cm-cap">{parody || t("community.noParody")}</h2>
                <span className="cm-title-sub">{t("community.charactersCount", { count: shown?.length ?? 0 })}</span>
              </div>
            </div>
          ) : (
            <>
              <SearchPill value={query} onChange={setQuery} placeholder={t("community.searchCharacters")} />
              {!q && items && (
                <div className="cm-toolbar">
                  <Segment
                    value={view}
                    onChange={setView}
                    options={[
                      { key: "parodies", label: t("community.byParody") },
                      { key: "all", label: t("community.allCharacters") },
                    ]}
                  />
                  <span className="cm-toolbar-note">{t("community.catalogSummary", { characters: items.length, parodies: groups.length })}</span>
                </div>
              )}
            </>
          )}
        </div>
        {body}
      </div>
      <CharacterSheet item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CharacterPoster({ item, onPress }: { item: CharacterCatalogItem; onPress: () => void }) {
  const { t } = useI18n();
  return (
    <div className="ax-poster" role="button" tabIndex={0} onClick={onPress} onKeyDown={(e) => e.key === "Enter" && onPress()}>
      <div className="ax-poster-cover cm-collage n1">
        <CroppedImage url={item.imageUrl} rect={item.rect} />
        {(item.userName || item.cardsCount > 1) && (
          <span className="ax-poster-badges">
            {item.userName && <span className="cm-badge-text">{item.userName}</span>}
            {item.cardsCount > 1 && (
              <span className="cm-badge-count">
                <Icon name="copy" size={13} />
                {item.cardsCount}
              </span>
            )}
          </span>
        )}
      </div>
      <h3 className="ax-poster-title cm-cap">{item.characterName}</h3>
      <div className="ax-poster-sub cm-cap">{item.parodyName || t("community.noParody")}</div>
    </div>
  );
}

/** Шторка персонажа: крупная карточка, все карточки, действия. */
function CharacterSheet({ item, onClose }: { item: CharacterCatalogItem | null; onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [cards, setCards] = useState<CharacterCard[] | null>(null);
  const [active, setActive] = useState(0);
  // Последний открытый — чтобы шторка не пустела, пока уезжает
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);

  useEffect(() => {
    if (!item) return;
    let alive = true;
    setCards(null);
    setActive(0);
    getCharacterCards(item.characterName, item.parodyName).then(
      (list) => alive && setCards(list),
      () => alive && setCards([]),
    );
    return () => {
      alive = false;
    };
  }, [item]);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  const card = cards?.[active];
  const it = shown;
  const bookId = card?.bookId ?? it?.bookId ?? null;
  const author = card?.userName ?? it?.userName;

  return (
    <NhModal visible={!!item} onClose={onClose} title={it ? <span className="cm-cap">{it.characterName}</span> : undefined} heightPercent={0.92} className="cm-modal">
      {it && (
        <div className="cm-sheet is-character">
          <div className="cm-hero">
            <CroppedImage url={card?.imageUrl ?? it.imageUrl} rect={card?.rect ?? it.rect} />
          </div>
          <div className="cm-sheet-side">
          <div className="cm-hero-meta">
            <span className="cm-cap">{it.parodyName || t("community.noParody")}</span>
            {author && <span>{t("community.addedBy", { name: author })}</span>}
            {card?.createdAt && <span>{new Date(card.createdAt).toLocaleDateString()}</span>}
          </div>

          {cards && cards.length > 1 && (
            <ListGroup title={t("community.allCards", { count: cards.length })} padded>
              <div className="cm-strip">
                {cards.map((c, i) => (
                  <button key={c.id} type="button" className={i === active ? "cm-strip-item is-active" : "cm-strip-item"} onClick={() => setActive(i)}>
                    <CroppedImage url={c.imageUrl} rect={c.rect} />
                  </button>
                ))}
              </div>
            </ListGroup>
          )}

          <ListGroup>
            <ListRow
              icon="search"
              color="#2f9be8"
              title={t("community.findBooks")}
              sub={tagQuery("character", it.characterName)}
              onPress={() => go(`/explore?query=${encodeURIComponent(tagQuery("character", it.characterName))}&solo=1`)}
            />
            {it.parodyName && (
              <ListRow
                icon="book"
                color="#8e6cf0"
                title={t("community.findParody")}
                sub={tagQuery("parody", it.parodyName)}
                onPress={() => go(`/explore?query=${encodeURIComponent(tagQuery("parody", it.parodyName!))}&solo=1`)}
              />
            )}
            {bookId != null && (
              <ListRow
                icon="book-open"
                color="#34c27a"
                title={t("community.openBook")}
                sub={card ? t("community.sourcePage", { id: bookId, page: card.pageIndex + 1 }) : `#${bookId}`}
                onPress={() => go(`/book/${bookId}`)}
              />
            )}
          </ListGroup>
          </div>
        </div>
      )}
    </NhModal>
  );
}

/**
 * Вырезанная часть страницы, заполняет рамку без искажений: SVG с viewBox по области карточки.
 * Размер картинки нужен заранее — грузим её (с запасными зеркалами и расширениями) и только потом рисуем.
 */
function CroppedImage({ url, rect }: { url: string | null; rect: CardRect | null }) {
  const [img, setImg] = useState<{ src: string; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setImg(null);
    setFailed(false);
    if (!url) return;
    let alive = true;
    const sources = pageSources(url);
    const tryAt = (i: number) => {
      if (i >= sources.length) return alive && setFailed(true);
      const el = new Image();
      el.onload = () => alive && setImg({ src: sources[i], w: el.naturalWidth, h: el.naturalHeight });
      el.onerror = () => alive && tryAt(i + 1);
      el.src = sources[i];
    };
    tryAt(0);
    return () => {
      alive = false;
    };
  }, [url]);

  if (!url || failed) {
    return (
      <span className="cm-crop is-empty">
        <Icon name="user" size={28} />
      </span>
    );
  }
  if (!img) return <span className="cm-crop is-loading" />;
  if (!rect) {
    return (
      <span className="cm-crop">
        <img src={img.src} alt="" />
      </span>
    );
  }
  return (
    <span className="cm-crop">
      <svg viewBox={`${rect.x * img.w} ${rect.y * img.h} ${rect.width * img.w} ${rect.height * img.h}`} preserveAspectRatio="xMidYMid slice">
        <image href={img.src} width={img.w} height={img.h} />
      </svg>
    </span>
  );
}

// ─── Перевод тегов ────────────────────────────────────────────────────────────

const PAGE_SIZE = 60;

const TYPE_ICON: Record<TranslationTagType, IconName> = {
  tag: "tag",
  artist: "pen-tool",
  parody: "book",
  character: "user",
  group: "users",
  category: "folder",
  language: "globe",
};
const TYPE_COLOR: Record<TranslationTagType, string> = {
  tag: "#2f9be8",
  artist: "#f0884a",
  parody: "#8e6cf0",
  character: "#e8577e",
  group: "#34c27a",
  category: "#9a9a9a",
  language: "#2fc1c8",
};

type TrMode = "tags" | "feed" | "files" | "mod";
type FeedUser = { id: number; label: string };

/** Пароль модератора — на время работы приложения, не сохраняется; нужен, только если токен не подтверждён. */
let moderatorPassword = "";

const NO_RIGHTS: CommunityMe = { isModerator: false, banned: false, verified: false };
/** Права текущего пользователя в разделе — для всех вложенных строк и шторок. */
const RightsContext = createContext<CommunityMe>(NO_RIGHTS);
const useRights = () => useContext(RightsContext);
/** Пароль для запроса модерации: с подтверждённым токеном не нужен. */
const modPassword = (rights: CommunityMe) => (rights.verified ? undefined : moderatorPassword);

/** Права с сервера; перепроверяются при возврате в окно (бан, обновлённый сервер). */
function useCommunityMe(): CommunityMe {
  const me = useMe();
  const [info, setInfo] = useState<CommunityMe>(NO_RIGHTS);
  useEffect(() => {
    if (!me) {
      setInfo(NO_RIGHTS);
      return;
    }
    let alive = true;
    const check = () => void getCommunityMe(me.id).then((x) => alive && setInfo(x));
    const onVisible = () => document.visibilityState === "visible" && check();
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me]);
  return info;
}

type T = (k: string, p?: Record<string, string | number>) => string;

/** Понятный текст ошибки сервера сообщества. */
function communityErrorText(e: unknown, t: T): string {
  if (!(e instanceof CommunityError)) return errorText(e);
  switch (e.code) {
    case "auth_required":
    case "auth_invalid":
      return t("community.errAuth");
    case "verify_unavailable":
      return t("community.errVerify");
    case "editor_banned":
      return t("community.banned");
    case "rate_limited":
      return t("community.errRate", { limit: String(e.extra.limit ?? ""), window: t(e.extra.window === "1d" ? "community.errRateDay" : "community.errRate10m") });
    case "tag_locked":
      return t("community.errLocked");
    case "delete_forbidden":
      return t("community.errDelete");
    case "too_long":
      return t("community.errTooLong", { limit: String(e.extra.limit ?? 200) });
    case "invalid_password":
      return t("community.modBadPassword");
    case "moderator_forbidden":
      return t("community.modForbidden");
    case "cannot_ban_moderator":
      return t("community.errBanModerator");
    case "file_too_big":
      return t("community.errFileBig", { limit: String(e.extra.limit ?? "") });
    case "nothing_to_submit":
      return t("community.fileNothing");
    case "too_many_pending":
      return t("community.errPending", { limit: String(e.extra.limit ?? "") });
    case "submission_closed":
      return t("community.errClosed");
    default:
      return e.code;
  }
}

function TranslationsPage() {
  const { t, resolved } = useI18n();
  const community = useCommunityMe();
  const [mode, setMode] = useState<TrMode>("tags");
  const [locale, setLocale] = useState<TranslationLocale>(() => appLocale(resolved));
  const [open, setOpen] = useState<TranslationRow | null>(null);
  const [feedUser, setFeedUser] = useState<FeedUser | null>(null);
  const [lastTable, setLastTable] = useState<TranslationTable | null>(null);
  // Сохранённый в шторке перевод — сразу и в списке
  const [patched, setPatched] = useState<TranslationRow | null>(null);
  const [openSubmission, setOpenSubmission] = useState<number | null>(null);
  // После рассмотрения / отзыва заявки — перечитать списки заявок
  const [submissionsKey, setSubmissionsKey] = useState(0);

  useEffect(() => {
    if (mode === "mod" && !community.isModerator) setMode("tags");
  }, [mode, community.isModerator]);

  const modes: { key: TrMode; label: string }[] = [
    { key: "tags", label: t("community.modeTags") },
    { key: "feed", label: t("community.modeFeed") },
    { key: "files", label: t("community.modeFiles") },
    ...(community.isModerator ? [{ key: "mod" as const, label: t("community.modeModeration") }] : []),
  ];

  return (
    <RightsContext.Provider value={community}>
    <div className="screen-scroll">
      <div className="cm-page cm-padded">
        <Segment value={mode} onChange={setMode} options={modes} />
        {community.banned && <ListHint>{t("community.banned")}</ListHint>}
        {mode === "tags" && <TagsMode locale={locale} setLocale={setLocale} onOpen={setOpen} onTable={setLastTable} patched={patched} />}
        {mode === "files" && <FilesMode locale={locale} onOpenSubmission={setOpenSubmission} reloadKey={submissionsKey} />}
        {mode === "feed" && <FeedMode user={feedUser} setUser={setFeedUser} isModerator={community.isModerator} onOpenTag={setOpen} />}
        {mode === "mod" && community.isModerator && (
          <ModerationMode
            table={lastTable}
            onOpenSubmission={setOpenSubmission}
            submissionsKey={submissionsKey}
            onOpenTag={setOpen}
            onOpenUser={(u) => {
              setFeedUser(u);
              setMode("feed");
            }}
          />
        )}
      </div>
      <TagSheet
        row={open}
        locale={locale}
        onClose={() => setOpen(null)}
        onSaved={(r) => {
          setOpen(r);
          setPatched(r);
        }}
      />
      <SubmissionSheet id={openSubmission} onClose={() => setOpenSubmission(null)} onChanged={() => setSubmissionsKey((k) => k + 1)} />
    </div>
    </RightsContext.Provider>
  );
}

function TagsMode({
  locale,
  setLocale,
  onOpen,
  onTable,
  patched,
}: {
  locale: TranslationLocale;
  setLocale: (l: TranslationLocale) => void;
  onOpen: (row: TranslationRow) => void;
  onTable: (t: TranslationTable) => void;
  patched: TranslationRow | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [status, setStatus] = useState<TranslationStatus>("all");
  const [sort, setSort] = useState<TranslationSort>("popular");
  const [type, setType] = useState<TranslationTagType | null>(null);
  const [query, setQuery] = useState("");
  const search = useDebounced(query, 300);
  const [stats, setStats] = useState<TranslationStats | null>(null);
  const [table, setTable] = useState<TranslationTable | null>(null);
  const [rows, setRows] = useState<TranslationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTranslationStats().then(setStats, () => {});
  }, [patched]);

  useEffect(() => {
    if (!patched) return;
    setRows((prev) => prev.map((r) => (r.tagType === patched.tagType && r.originalName === patched.originalName ? patched : r)));
  }, [patched]);

  const load = useCallback(
    (offset: number) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      getTranslationTable({ search, tagTypes: type ? [type] : [], locale, status, sort, limit: PAGE_SIZE, offset })
        .then((res) => {
          if (id !== request.current) return;
          setTable(res);
          onTable(res);
          setRows((prev) => (offset ? [...prev, ...res.rows] : res.rows));
        })
        .catch((e) => id === request.current && setError(errorText(e)))
        .finally(() => id === request.current && setLoading(false));
    },
    [search, type, locale, status, sort, onTable],
  );

  useEffect(() => {
    setRows([]);
    setTable(null);
    load(0);
  }, [load]);

  // Подгрузка, когда низ списка показался
  const hasMore = table != null && rows.length < table.total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading || error) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && load(rows.length), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, error, rows.length, load]);

  const progress = table?.progress;

  return (
    <>
      <ListGroup title={t("community.progress")} padded>
        <div className="cm-progress">
          {TRANSLATION_LOCALES.map((l) => {
            const done = progress?.byLocale[l] ?? 0;
            const pct = progress?.total ? (done / progress.total) * 100 : 0;
            return (
              <button key={l} type="button" className={l === locale ? "cm-progress-row is-active" : "cm-progress-row"} onClick={() => setLocale(l)}>
                <span className="cm-progress-lang">{l.toUpperCase()}</span>
                <span className="cm-progress-bar">
                  <span style={{ width: `${done ? Math.max(pct, 0.8) : 0}%` }} />
                </span>
                <span className="cm-progress-num">{progress ? `${compact(done)} · ${pct < 1 && done ? pct.toFixed(1) : Math.round(pct)}%` : "—"}</span>
              </button>
            );
          })}
        </div>
        {stats && (
          <div className="cm-progress-foot">
            <span>{t("community.statLine", { total: compact(progress?.total ?? stats.totalTranslated), edits: stats.communityEdits })}</span>
            {stats.contributors.slice(0, 6).map((c) =>
              c.userId != null ? (
                <button key={`${c.userId}|${c.label}`} type="button" className="cm-chip" title={t("community.openProfile")} onClick={() => navigate(profileRoute(c.userId!, c.label))}>
                  {c.label} · {c.count}
                </button>
              ) : (
                <span key={c.label} className="cm-chip">
                  {c.label} · {c.count}
                </span>
              ),
            )}
          </div>
        )}
      </ListGroup>

      <SearchPill value={query} onChange={setQuery} placeholder={t("community.searchTags")} />

      <div className="cm-toolbar is-wrap">
        <Segment
          value={status}
          onChange={setStatus}
          label={t("community.status")}
          options={[
            { key: "all", label: t("community.statusAll") },
            { key: "missing", label: t("community.statusMissing", { lang: locale.toUpperCase() }) },
            { key: "done", label: t("community.statusDone") },
          ]}
        />
        <Segment
          value={sort}
          onChange={setSort}
          label={t("community.sort")}
          options={[
            { key: "popular", label: t("community.sortPopular") },
            { key: "name", label: t("community.sortName") },
            { key: "recent", label: t("community.sortRecent") },
          ]}
        />
      </div>

      <div className="cm-chips">
        <button type="button" className={type == null ? "cm-chip is-active" : "cm-chip"} onClick={() => setType(null)}>
          {t("community.allTypes")}
        </button>
        {TRANSLATION_TAG_TYPES.map((x) => (
          <button key={x} type="button" className={type === x ? "cm-chip is-active" : "cm-chip"} onClick={() => setType(type === x ? null : x)}>
            <Icon name={TYPE_ICON[x]} size={14} />
            {t(`community.types.${x}`)}
            {table?.facets[x] != null && <span className="cm-chip-num">{compact(table.facets[x]!)}</span>}
          </button>
        ))}
      </div>

      {table && <div className="cm-total">{t("community.found", { count: table.total })}</div>}

      {rows.length > 0 && (
        <ListGroup>
          {rows.map((row) => (
            <TagRow key={`${row.tagType}|${row.originalName}`} row={row} locale={locale} onPress={() => onOpen(row)} />
          ))}
        </ListGroup>
      )}

      {error ? (
        <NoResultsPanel iconName="alert-circle" title={t("community.error", { error })} actions={[{ label: t("common.retry"), onPress: () => load(rows.length) }]} />
      ) : loading ? (
        <div className="cm-loading">
          <Spinner size={22} />
        </div>
      ) : (
        table?.total === 0 && <p className="cm-empty">{t("common.nothingFound")}</p>
      )}
      <div ref={sentinel} />
    </>
  );
}

function TagRow({ row, locale, onPress }: { row: TranslationRow; locale: TranslationLocale; onPress: () => void }) {
  const { t } = useI18n();
  const value = row.values[locale];
  return (
    <button type="button" className="set-row cm-tag-row" onClick={onPress}>
      <TileIcon icon={TYPE_ICON[row.tagType] ?? "tag"} color={TYPE_COLOR[row.tagType] ?? "#888"} size={20} />
      <span className="set-row-text">
        <span className="set-row-title">{row.originalName}</span>
        <span className={value ? "set-row-sub cm-tr-value" : "set-row-sub cm-tr-missing"}>{value || t("community.noTranslation")}</span>
      </span>
      <span className="set-row-trail cm-tag-count">
        {row.descriptions[locale] && <Icon name="file-text" size={14} className="cm-has-desc" />}
        {row.locked && <Icon name="lock" size={14} className="cm-lock" />}
        {row.count > 0 && compact(row.count)}
        <Icon name="chevron-right" size={18} />
      </span>
    </button>
  );
}

/** Шторка тега: перевод на все языки сразу, история правок, поиск книг. */
function TagSheet({
  row,
  locale,
  onClose,
  onSaved,
}: {
  row: TranslationRow | null;
  locale: TranslationLocale;
  onClose: () => void;
  onSaved: (row: TranslationRow) => void;
}) {
  const { t, resolved } = useI18n();
  const rights = useRights();
  const isModerator = rights.isModerator;
  const { showToast } = useToast();
  const navigate = useNavigate();
  const me = useMe();
  // Последний открытый — чтобы шторка не пустела, пока уезжает
  const [shown, setShown] = useState(row);
  if (row && row !== shown) setShown(row);
  const [drafts, setDrafts] = useState<Record<TranslationLocale, string>>({ en: "", ru: "", ja: "", zh: "" });
  const [descDrafts, setDescDrafts] = useState<Record<TranslationLocale, string>>({ en: "", ru: "", ja: "", zh: "" });
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [saving, setSaving] = useState(false);

  const rowKey = row ? `${row.tagType}|${row.originalName}` : "";
  useEffect(() => {
    if (!row) return;
    setDrafts({ ...row.values });
    setDescDrafts({ ...row.descriptions });
    let alive = true;
    setHistory(null);
    getTagHistory(row.tagType, row.originalName).then(
      (h) => alive && setHistory(h),
      () => alive && setHistory([]),
    );
    return () => {
      alive = false;
    };
    // Только при открытии другого тега — после сохранения поля не сбрасываются
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  const r = shown;
  const changedNames = r ? TRANSLATION_LOCALES.filter((l) => drafts[l].trim() !== r.values[l]) : [];
  const changedDescs = r ? TRANSLATION_LOCALES.filter((l) => descDrafts[l].trim() !== r.descriptions[l]) : [];
  const changed = [...changedNames, ...changedDescs];
  // Заблокированный тег правят только модераторы
  const readOnly = !!r?.locked && !isModerator;
  const reloadHistory = () => {
    if (r) getTagHistory(r.tagType, r.originalName).then(setHistory, () => {});
  };

  const toggleLock = async () => {
    if (!r || !me) return;
    try {
      await setTagLock({ userId: me.id, password: modPassword(rights), tagType: r.tagType, tagName: r.originalName, lock: !r.locked });
      showToast({ type: "success", title: t(r.locked ? "community.unlocked" : "community.locked") });
      onSaved({ ...r, locked: !r.locked });
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    }
  };

  const revert = async (h: HistoryEntry) => {
    if (!r || !me || !window.confirm(t("community.revertConfirm"))) return;
    try {
      await revertEdit({ userId: me.id, password: modPassword(rights), historyId: h.id });
      if (h.action.startsWith("describe")) {
        setDescDrafts((d) => ({ ...d, [h.locale]: h.oldValue ?? "" }));
        onSaved({ ...r, descriptions: { ...r.descriptions, [h.locale]: h.oldValue ?? "" } });
      } else {
        setDrafts((d) => ({ ...d, [h.locale]: h.oldValue ?? "" }));
        onSaved({ ...r, values: { ...r.values, [h.locale]: h.oldValue ?? "" } });
      }
      showToast({ type: "success", title: t("community.reverted") });
      reloadHistory();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    }
  };

  const save = async () => {
    if (!r || saving) return;
    if (!me) return openLogin();
    if (!changed.length) return;
    setSaving(true);
    const values = { ...r.values };
    const descriptions = { ...r.descriptions };
    try {
      for (const l of changedNames) {
        const v = drafts[l].trim();
        await saveTranslation({ userId: me.id, userName: me.username, tagType: r.tagType, tagName: r.originalName, locale: l, translatedName: v });
        values[l] = v;
        setTagTranslation(l, r.tagType, r.originalName, v);
      }
      for (const l of changedDescs) {
        const v = descDrafts[l].trim();
        await saveDescription({ userId: me.id, userName: me.username, tagType: r.tagType, tagName: r.originalName, locale: l, description: v });
        descriptions[l] = v;
      }
      showToast({ type: "success", title: t("community.saved") });
      reloadHistory();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    } finally {
      // Что успело сохраниться — показать и в списке
      onSaved({ ...r, values, descriptions });
      setSaving(false);
    }
  };

  const copyJson = async () => {
    if (!r) return;
    await navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).catch(() => {});
    showToast({ type: "info", title: t("community.copied") });
  };

  return (
    <NhModal visible={!!row} onClose={onClose} title={r?.originalName} heightPercent={0.92} className="cm-modal">
      {r && (
        <div className="cm-sheet is-tag">
          <div className="cm-sheet-main">
          <div className="cm-tag-meta">
            <span className="cm-chip">
              <Icon name={TYPE_ICON[r.tagType] ?? "tag"} size={14} />
              {t(`community.types.${r.tagType}`)}
            </span>
            {r.count > 0 && <span className="cm-chip">{t("community.booksCount", { count: compact(r.count) })}</span>}
            {r.locked && (
              <span className="cm-chip is-warn">
                <Icon name="lock" size={14} />
                {t("community.lockedChip")}
              </span>
            )}
          </div>
          {readOnly && <ListHint>{t("community.lockedHint")}</ListHint>}

          <ListGroup title={t("community.translationsTitle")} padded>
            {TRANSLATION_LOCALES.map((l) => {
              const audit = r.audit[l];
              return (
                <label key={l} className={l === locale ? "cm-field is-current" : "cm-field"}>
                  <span className="cm-field-lang">{l.toUpperCase()}</span>
                  <span className="cm-field-body">
                    <input
                      value={drafts[l]}
                      disabled={readOnly}
                      placeholder={t("community.translationPlaceholder", { lang: l.toUpperCase() })}
                      onChange={(e) => setDrafts((d) => ({ ...d, [l]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && void save()}
                    />
                    {audit?.updatedBy && (
                      <span className="cm-field-audit">
                        {t("community.editedBy", { name: audit.updatedBy })}
                        {audit.updatedAt && ` · ${timeAgo(audit.updatedAt, resolved)}`}
                      </span>
                    )}
                    <textarea
                      className="cm-desc-input"
                      value={descDrafts[l]}
                      rows={descDrafts[l] ? 2 : 1}
                      maxLength={500}
                      disabled={readOnly}
                      placeholder={t("community.descPlaceholder", { lang: l.toUpperCase() })}
                      onChange={(e) => setDescDrafts((d) => ({ ...d, [l]: e.target.value }))}
                    />
                    {r.descAudit[l]?.updatedBy && (
                      <span className="cm-field-audit">
                        {t("community.descEditedBy", { name: r.descAudit[l]!.updatedBy })}
                        {r.descAudit[l]!.updatedAt && ` · ${timeAgo(r.descAudit[l]!.updatedAt, resolved)}`}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </ListGroup>

          <div className="cm-actions">
            <button type="button" className="ax-btn ax-btn-primary" disabled={saving || readOnly || (!!me && !changed.length)} onClick={() => void save()}>
              {saving ? <Spinner size={18} /> : me ? t("community.save") : t("community.loginToEdit")}
            </button>
            <button
              type="button"
              className="ax-btn ax-btn-ghost"
              onClick={() => {
                onClose();
                navigate(`/explore?query=${encodeURIComponent(tagQuery(r.tagType, r.originalName))}&solo=1`);
              }}
            >
              <Icon name="search" size={18} />
              {t("community.findBooks")}
            </button>
          </div>
          </div>

          <div className="cm-sheet-side">
          <ListGroup title={t("community.history")}>
            {history == null ? (
              <div className="cm-loading">
                <Spinner size={20} />
              </div>
            ) : history.length ? (
              history.map((h) => <HistoryRow key={h.id} entry={h} showTag={false} onRevert={isModerator ? () => void revert(h) : undefined} />)
            ) : (
              <p className="cm-empty is-small">{t("community.noHistory")}</p>
            )}
          </ListGroup>

          {isModerator && (
            <ListGroup title={t("community.modeModeration")}>
              <ListRow
                icon="lock"
                color={r.locked ? "#34c27a" : "#e5484d"}
                title={t(r.locked ? "community.unlockTag" : "community.lockTag")}
                sub={t("community.lockTagSub")}
                onPress={() => void toggleLock()}
              />
            </ListGroup>
          )}
          {isModerator && (
            <ListGroup title={t("community.developer")}>
              <ListRow icon="copy" color="#9a9a9a" title={t("community.copyJson")} sub={`${r.tagType}|${r.originalName.toLowerCase()}`} onPress={() => void copyJson()} />
            </ListGroup>
          )}
          </div>
        </div>
      )}
    </NhModal>
  );
}

function HistoryRow({ entry, showTag, onUser, onTag, onRevert }: { entry: HistoryEntry; showTag: boolean; onUser?: () => void; onTag?: () => void; onRevert?: () => void }) {
  const { t, resolved } = useI18n();
  const removed = !entry.newValue;
  return (
    <div className="cm-hist">
      <div className="cm-hist-top">
        {showTag && (
          <button type="button" className="cm-hist-tag" onClick={onTag}>
            <Icon name={TYPE_ICON[entry.tagType] ?? "tag"} size={14} />
            {entry.tagName}
          </button>
        )}
        <span className="cm-hist-lang">{entry.locale.toUpperCase()}</span>
        {entry.action.startsWith("describe") && <span className="cm-hist-lang is-desc">{t("community.descLabel")}</span>}
        <span className="cm-hist-time">{timeAgo(entry.createdAt, resolved)}</span>
      </div>
      <div className="cm-hist-change">
        {entry.oldValue && <s>{entry.oldValue}</s>}
        {entry.oldValue && !removed && <Icon name="arrow-right" size={14} />}
        {removed ? <em>{t("community.removed")}</em> : <b>{entry.newValue}</b>}
      </div>
      <div className="cm-hist-by">
        {onUser ? (
          <button type="button" onClick={onUser}>
            {entry.updatedBy}
          </button>
        ) : (
          <span>{entry.updatedBy}</span>
        )}
        {entry.source !== "community-ui" && <span className="cm-hist-source">{entry.source}</span>}
        {onRevert && (
          <button type="button" className="cm-hist-revert" onClick={onRevert}>
            <Icon name="rotate-ccw" size={13} />
            {t("community.revert")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Строка таблицы по тегу (имя с запятой на конце — точное совпадение на сервере). */
async function findRow(tagType: TranslationTagType, name: string, locale: TranslationLocale): Promise<TranslationRow | null> {
  const res = await getTranslationTable({ search: `${name},`, tagTypes: [tagType], locale, status: "all", sort: "name", limit: 5, offset: 0 });
  return res.rows.find((r) => r.originalName.toLowerCase() === name.toLowerCase()) ?? res.rows[0] ?? null;
}

function FeedMode({
  user,
  setUser,
  isModerator,
  onOpenTag,
}: {
  user: FeedUser | null;
  setUser: (u: FeedUser | null) => void;
  isModerator: boolean;
  onOpenTag: (row: TranslationRow) => void;
}) {
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const rights = useRights();
  const me = useMe();
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(
    (beforeId?: number) => {
      const id = ++request.current;
      setLoading(true);
      setError(null);
      getRecentEdits({ limit: 50, beforeId, userId: user?.id })
        .then((list) => {
          if (id !== request.current) return;
          setItems((prev) => (beforeId ? [...prev, ...list] : list));
          setDone(list.length < 50);
        })
        .catch((e) => id === request.current && setError(errorText(e)))
        .finally(() => id === request.current && setLoading(false));
    },
    [user],
  );

  useEffect(() => {
    setItems([]);
    setDone(false);
    load();
  }, [load]);

  const openTag = async (h: HistoryEntry) => {
    try {
      const row = await findRow(h.tagType, h.tagName, appLocale(resolved));
      if (row) onOpenTag(row);
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: errorText(e) });
    }
  };

  const revert = async (h: HistoryEntry) => {
    if (!me || !window.confirm(t("community.revertConfirm"))) return;
    try {
      await revertEdit({ userId: me.id, password: modPassword(rights), historyId: h.id });
      showToast({ type: "success", title: t("community.reverted") });
      load();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    }
  };
  const lastId = items[items.length - 1]?.id;
  // Ник — из ленты (сервер подставляет текущий ник аккаунта), а не из подписи, по которой открыли
  const userName = (user && items.find((h) => h.editorUserId === user.id)?.updatedBy) || user?.label || "";

  return (
    <>
      {user && (
        <ListGroup>
          <div className="cm-user-filter">
            <TileIcon icon="user" color="#2f9be8" />
            <span className="set-row-text">
              <span className="set-row-title">{userName}</span>
              <span className="set-row-sub">{t("community.userEdits", { id: user.id })}</span>
            </span>
            <button type="button" className="ax-btn ax-btn-ghost cm-small-btn" onClick={() => navigate(profileRoute(user.id, userName))}>
              <Icon name="user" size={16} />
              {t("community.openProfile")}
            </button>
            <button type="button" className="ax-icon-btn" aria-label={t("common.reset")} onClick={() => setUser(null)}>
              <Icon name="x" size={20} />
            </button>
          </div>
          {isModerator && <UserModeration userId={user.id} label={userName} onDone={() => load()} />}
        </ListGroup>
      )}

      {items.length > 0 && (
        <ListGroup>
          {items.map((h) => (
            <HistoryRow
              key={h.id}
              entry={h}
              showTag
              onTag={() => void openTag(h)}
              onUser={h.editorUserId != null && h.editorUserId !== user?.id ? () => setUser({ id: h.editorUserId!, label: h.updatedBy }) : undefined}
              onRevert={isModerator && h.source !== "revert" ? () => void revert(h) : undefined}
            />
          ))}
        </ListGroup>
      )}

      {error ? (
        <NoResultsPanel iconName="alert-circle" title={t("community.error", { error })} actions={[{ label: t("common.retry"), onPress: () => load(lastId) }]} />
      ) : loading ? (
        <div className="cm-loading">
          <Spinner size={22} />
        </div>
      ) : !items.length ? (
        <p className="cm-empty">{t("community.noHistory")}</p>
      ) : (
        !done && (
          <button type="button" className="ax-btn ax-btn-ghost cm-more" onClick={() => load(lastId)}>
            {t("community.loadMore")}
          </button>
        )
      )}
    </>
  );
}

/** Пароль модератора (только без подтверждённого токена): хранится до перезапуска приложения. */
function PasswordField() {
  const { t } = useI18n();
  const rights = useRights();
  const [value, setValue] = useState(moderatorPassword);
  if (rights.verified) return null;
  return (
    <label className="cm-field">
      <span className="cm-field-lang">
        <Icon name="lock" size={16} />
      </span>
      <span className="cm-field-body">
        <input
          type="password"
          value={value}
          placeholder={t("community.modPassword")}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value);
            moderatorPassword = e.target.value;
          }}
        />
        <span className="cm-field-audit">{t("community.modPasswordHint")}</span>
      </span>
    </label>
  );
}

/** Сводка по пользователю, бан / разбан (можно сразу с откатом) и откат правок за период. */
function UserModeration({ userId, label, onDone }: { userId: number; label: string; onDone: () => void }) {
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  const rights = useRights();
  const me = useMe();
  const [period, setPeriod] = useState<RollbackPeriod>("7d");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<EditorSummary | null>(null);

  const loadSummary = useCallback(() => {
    if (!me) return;
    getEditorSummary(me.id, userId).then(setSummary, () => setSummary(null));
  }, [me, userId]);
  useEffect(loadSummary, [loadSummary]);

  const run = async (confirmText: string | null, action: () => Promise<string>) => {
    if (!me || busy) return;
    if (!rights.verified && !moderatorPassword) return showToast({ type: "error", title: t("community.modPassword") });
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      showToast({ type: "success", title: await action() });
      onDone();
      loadSummary();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const who = () => ({ userId: me!.id, userName: me!.username, password: modPassword(rights), targetUserId: userId });
  const periodLabel = t(`community.periods.${period}`);
  const banned = summary?.banned ?? false;

  return (
    <div className="cm-mod">
      {summary && (
        <div className="cm-mod-stats">
          <span>
            <b>{summary.lastHour}</b>
            {t("community.statHour")}
          </span>
          <span>
            <b>{summary.lastDay}</b>
            {t("community.statDay")}
          </span>
          <span>
            <b>{summary.total}</b>
            {t("community.statTotal")}
          </span>
          {summary.firstAt && <span>{t("community.firstEdit", { time: timeAgo(summary.firstAt, resolved) })}</span>}
          {banned && <span className="cm-chip is-warn">{t("community.isBanned")}</span>}
        </div>
      )}
      <PasswordField />
      <div className="cm-mod-row">
        <span className="cm-mod-label">{t("community.rollbackFor")}</span>
        <Segment value={period} onChange={setPeriod} options={ROLLBACK_PERIODS.map((p) => ({ key: p, label: t(`community.periods.${p}`) }))} />
      </div>
      <div className="cm-actions">
        {!banned && (
          <button
            type="button"
            className="ax-btn ax-btn-primary cm-danger-fill"
            disabled={busy}
            onClick={() =>
              void run(t("community.banRollbackConfirm", { name: label, period: periodLabel }), async () => {
                const n = await setEditorBan({ ...who(), ban: true, rollback: period });
                return t("community.bannedRolledBack", { name: label, count: n });
              })
            }
          >
            {t("community.banRollback")}
          </button>
        )}
        <button
          type="button"
          className="ax-btn ax-btn-ghost"
          disabled={busy}
          onClick={() =>
            void run(t("community.rollbackConfirm", { name: label, period: periodLabel }), async () => {
              const n = await rollbackEditor({ ...who(), period });
              return t("community.rolledBack", { count: n });
            })
          }
        >
          <Icon name="rotate-ccw" size={18} />
          {t("community.rollback")}
        </button>
        {banned ? (
          <button
            type="button"
            className="ax-btn ax-btn-ghost"
            disabled={busy}
            onClick={() =>
              void run(null, async () => {
                await setEditorBan({ ...who(), ban: false });
                return t("community.unbannedUser", { name: label });
              })
            }
          >
            {t("community.unban")}
          </button>
        ) : (
          <button
            type="button"
            className="ax-btn ax-btn-ghost cm-danger"
            disabled={busy}
            onClick={() =>
              void run(null, async () => {
                await setEditorBan({ ...who(), ban: true });
                return t("community.bannedUser", { name: label });
              })
            }
          >
            {t("community.banOnly")}
          </button>
        )}
      </div>
    </div>
  );
}

function ModerationMode({
  table,
  onOpenUser,
  onOpenTag,
  onOpenSubmission,
  submissionsKey,
}: {
  table: TranslationTable | null;
  onOpenUser: (u: FeedUser) => void;
  onOpenTag: (row: TranslationRow) => void;
  onOpenSubmission: (id: number) => void;
  submissionsKey: number;
}) {
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  const rights = useRights();
  const me = useMe();
  const [bans, setBans] = useState<EditorBan[] | null>(null);
  const [locks, setLocks] = useState<TagLock[] | null>(null);
  const [userId, setUserId] = useState("");

  const loadLists = useCallback(() => {
    if (!me) return;
    getEditorBans(me.id).then(setBans, (e) => {
      setBans([]);
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    });
    getTagLocks(me.id).then(setLocks, () => setLocks([]));
  }, [me, showToast, t]);
  useEffect(loadLists, [loadLists]);

  const unban = async (b: EditorBan) => {
    if (!me) return;
    if (!rights.verified && !moderatorPassword) return showToast({ type: "error", title: t("community.modPassword") });
    try {
      await setEditorBan({ userId: me.id, userName: me.username, password: modPassword(rights), targetUserId: b.userId, ban: false });
      showToast({ type: "success", title: t("community.unbannedUser", { name: b.username ?? `#${b.userId}` }) });
      loadLists();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    }
  };

  const unlock = async (l: TagLock) => {
    if (!me) return;
    try {
      await setTagLock({ userId: me.id, password: modPassword(rights), tagType: l.tagType, tagName: l.tagName, lock: false });
      showToast({ type: "success", title: t("community.unlocked") });
      loadLists();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    }
  };

  const openLocked = async (l: TagLock) => {
    try {
      const row = await findRow(l.tagType, l.tagName, appLocale(resolved));
      if (row) onOpenTag(row);
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: errorText(e) });
    }
  };

  const openUser = () => {
    const id = Number(userId.trim());
    if (Number.isFinite(id) && id > 0) onOpenUser({ id, label: `#${id}` });
  };

  // В окне приложения window.open ничего не открывает — скачиваем и сохраняем сами, как во вкладке «Файлы»
  const [exporting, setExporting] = useState<"all" | "missing" | null>(null);
  const exportCsv = async (kind: "all" | "missing") => {
    if (exporting) return;
    setExporting(kind);
    try {
      const f = await exportTranslationsCsv({ untranslatedOnly: kind === "missing" });
      const message = savedMessage(await saveTextFile(f.fileName, "text/csv", f.text), t);
      if (message) showToast({ type: "success", title: message });
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PendingSubmissions onOpen={onOpenSubmission} reloadKey={submissionsKey} />
      <ListGroup title={t("community.modAccess")} padded>
        <div className={rights.verified ? "cm-verified is-ok" : "cm-verified"}>
          <Icon name={rights.verified ? "check-circle" : "alert-circle"} size={18} />
          <span>{t(rights.verified ? "community.verifiedOk" : "community.verifiedNo")}</span>
        </div>
        <PasswordField />
        <label className="cm-field">
          <span className="cm-field-lang">ID</span>
          <span className="cm-field-body">
            <input value={userId} inputMode="numeric" placeholder={t("community.modUserId")} onChange={(e) => setUserId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && openUser()} />
          </span>
          <button type="button" className="ax-icon-btn" aria-label={t("community.modOpenUser")} onClick={openUser}>
            <Icon name="arrow-right" size={20} />
          </button>
        </label>
      </ListGroup>
      <ListHint>{t("community.protectionHint")}</ListHint>

      <ListGroup title={t("community.bans", { count: bans?.length ?? 0 })}>
        {bans == null ? (
          <div className="cm-loading">
            <Spinner size={20} />
          </div>
        ) : bans.length ? (
          bans.map((b) => (
            <div key={b.userId} className="set-row cm-ban">
              <TileIcon icon="lock" color="#e5484d" size={20} />
              <span className="set-row-text">
                <button type="button" className="set-row-title cm-link" onClick={() => onOpenUser({ id: b.userId, label: b.username ?? `#${b.userId}` })}>
                  {b.username ?? `#${b.userId}`}
                </button>
                <span className="set-row-sub">
                  {t("community.bannedBy", { name: b.bannedBy })} · {timeAgo(b.createdAt, resolved)}
                  {b.note ? ` · ${b.note}` : ""}
                </span>
              </span>
              <button type="button" className="ax-btn ax-btn-ghost cm-small-btn" onClick={() => void unban(b)}>
                {t("community.unban")}
              </button>
            </div>
          ))
        ) : (
          <p className="cm-empty is-small">{t("community.noBans")}</p>
        )}
      </ListGroup>

      <ListGroup title={t("community.locks", { count: locks?.length ?? 0 })}>
        {locks == null ? (
          <div className="cm-loading">
            <Spinner size={20} />
          </div>
        ) : locks.length ? (
          locks.map((l) => (
            <div key={`${l.tagType}|${l.tagName}`} className="set-row cm-ban">
              <TileIcon icon={TYPE_ICON[l.tagType] ?? "tag"} color={TYPE_COLOR[l.tagType] ?? "#888"} size={20} />
              <span className="set-row-text">
                <button type="button" className="set-row-title cm-link" onClick={() => void openLocked(l)}>
                  {l.tagName}
                </button>
                <span className="set-row-sub">
                  {t("community.lockedBy", { name: l.lockedBy })} · {timeAgo(l.createdAt, resolved)}
                </span>
              </span>
              <button type="button" className="ax-btn ax-btn-ghost cm-small-btn" onClick={() => void unlock(l)}>
                {t("community.unlockTag")}
              </button>
            </div>
          ))
        ) : (
          <p className="cm-empty is-small">{t("community.noLocks")}</p>
        )}
      </ListGroup>

      <ListGroup title={t("community.export")}>
        <ListRow
          icon="download"
          color="#34c27a"
          title={t("community.exportAll")}
          sub={t("community.exportAllSub")}
          trailing={exporting === "all" ? <Spinner size={18} /> : undefined}
          onPress={() => void exportCsv("all")}
        />
        <ListRow
          icon="download"
          color="#f0884a"
          title={t("community.exportMissing")}
          sub={t("community.exportMissingSub")}
          trailing={exporting === "missing" ? <Spinner size={18} /> : undefined}
          onPress={() => void exportCsv("missing")}
        />
        <AiPromptRow initialLocale="all" />
      </ListGroup>

      <ListGroup title={t("community.developer")} padded>
        <dl className="cm-dev">
          <dt>API</dt>
          <dd>{API_BASE_URL}</dd>
          <dt>{t("community.devLast")}</dt>
          <dd>{lastResponse.path || "—"}</dd>
          <dt>{t("community.devTiming")}</dt>
          <dd>
            {lastResponse.serverMs != null ? `${lastResponse.serverMs} ms ${t("community.devServer")} · ` : ""}
            {lastResponse.totalMs} ms {t("community.devTotal")}
          </dd>
          {table?.cache && (
            <>
              <dt>{t("community.devCache")}</dt>
              <dd>{t("community.devCacheAges", { tags: table.cache.tagsAgeSec, translations: table.cache.translationsAgeSec })}</dd>
            </>
          )}
          {table && !table.progress && (
            <>
              <dt>{t("community.devServerOld")}</dt>
              <dd>{t("community.devServerOldHint")}</dd>
            </>
          )}
        </dl>
      </ListGroup>
    </>
  );
}

// ─── Перевод файлом ───────────────────────────────────────────────────────────

type SaveResult = { kind: "saved"; path: string } | { kind: "shared" } | { kind: "downloaded" } | { kind: "canceled" };

function downloadBlob(fileName: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Сохранить текст файлом: на Android — через «Поделиться»; на ПК — системный диалог «Сохранить как»
 * и запись командой `save_text_file` (окно WebView скачивание по ссылке молча игнорирует); в браузере —
 * обычное скачивание. Старая нативная часть без команды — тоже скачивание.
 */
async function saveTextFile(fileName: string, mime: string, text: string): Promise<SaveResult> {
  if (window.NHAppNative?.shareText) {
    if (!window.NHAppNative.shareText(fileName, mime, text)) throw new Error("share");
    return { kind: "shared" };
  }
  if (inTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = fileName.split(".").pop() || "csv";
    const path = await save({ defaultPath: fileName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return { kind: "canceled" };
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("save_text_file", { path, text });
      return { kind: "saved", path };
    } catch (e) {
      if (!String(e).includes("not found")) throw e;
    }
  }
  downloadBlob(fileName, mime, text);
  return { kind: "downloaded" };
}

/** Текст тоста о сохранённом файле (или null — пользователь отменил). */
function savedMessage(r: SaveResult, t: T, count?: number): string | null {
  if (r.kind === "canceled") return null;
  const head = count != null ? t("community.fileSaved", { count }) : t("community.exportSaved");
  return r.kind === "saved" ? `${head}: ${r.path}` : r.kind === "shared" ? head : `${head} · ${t("community.savedToDownloads")}`;
}

/** Разбор CSV (кавычки, "" внутри, переносы в значениях). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const csvCell = (v: string) => (/[,"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Сколько строк уходит на сервер за раз (больше — сервер не примет в одну заявку). */
const UPLOAD_MAX_ROWS = 3000;

/**
 * Ужать файл перед отправкой: только строки с заполненным переводом, который отличается от текущего
 * (колонка-подсказка hint_<язык> в скачанном файле — это перевод на момент скачивания). Полный файл
 * каталога весит ~10 МБ, а сервер принимает запрос до 1 МБ — уходит только то, что реально изменили.
 */
interface CompactFile {
  /** Строки CSV без шапки (только изменённые). */
  lines: string[];
  /** Ключи `type|name|locale` тех же строк — для «перезаписать» при импорте. */
  keys: string[];
  filled: number;
  /** Перевод совпал с оригиналом (big breasts → big breasts) — такие строки ничего не дают. */
  sameAsOriginal: number;
  byLocale: Record<string, number>;
  badHeader: boolean;
}

const CSV_HEADER = "tag_type,tag_name,locale,translated_name";
const toCsv = (lines: string[]) => [CSV_HEADER, ...lines].join("\r\n") + "\r\n";

function compactTranslationFile(text: string): CompactFile {
  const all = parseCsv(text.replace(/^\uFEFF/, ""));
  const header = (all[0] ?? []).map((h) => h.trim().toLowerCase());
  const empty: CompactFile = { lines: [], keys: [], filled: 0, sameAsOriginal: 0, byLocale: {}, badHeader: false };
  if (["tag_type", "tag_name", "locale", "translated_name"].some((h, i) => header[i] !== h)) return { ...empty, badHeader: true };
  const hint = (locale: string) => header.indexOf(`hint_${locale}`);
  const out = { ...empty, byLocale: {} as Record<string, number> };
  for (const r of all.slice(1)) {
    const value = (r[3] ?? "").trim();
    if (!value) continue;
    out.filled++;
    const name = (r[1] ?? "").trim();
    const locale = (r[2] ?? "").trim().toLowerCase();
    const h = hint(locale);
    if (h >= 0 && (r[h] ?? "").trim() === value) continue;
    if (value.toLowerCase() === name.toLowerCase()) {
      out.sameAsOriginal++;
      continue;
    }
    out.lines.push([r[0] ?? "", name, locale, value].map(csvCell).join(","));
    out.keys.push(`${(r[0] ?? "").trim().toLowerCase()}|${name.toLowerCase()}|${locale}`);
    out.byLocale[locale] = (out.byLocale[locale] ?? 0) + 1;
  }
  return out;
}

/** Модератор применяет файл сразу — частями (сервер принимает запрос до 1 МБ). */
const BULK_CHUNK = 2000;

const FILE_LIMITS = ["100", "500", "1000", "5000", "all"] as const;
type FileLimit = (typeof FILE_LIMITS)[number];
const PREVIEW_SHOWN = 150;

const STATUS_COLOR: Record<PreviewStatus, string> = { new: "#34c27a", change: "#f0884a", same: "#9a9a9a", unknown: "#e5484d", locked: "#e5484d" };
const SUBMISSION_ICON: Record<SubmissionStatus, IconName> = { pending: "clock", approved: "check-circle", partial: "check-square", rejected: "x-circle", withdrawn: "corner-up-left" };
const SUBMISSION_COLOR: Record<SubmissionStatus, string> = { pending: "#f0b84a", approved: "#34c27a", partial: "#2f9be8", rejected: "#e5484d", withdrawn: "#9a9a9a" };

/** Строка предпросмотра: тег, было → стало, отметка. */
function PreviewRowView({ row, checked, onToggle }: { row: PreviewRow; checked?: boolean; onToggle?: () => void }) {
  const { t } = useI18n();
  const body = (
    <>
      {onToggle && <Icon name={checked ? "check-square" : "square"} size={18} className="cm-pv-check" />}
      <span className="cm-pv-text">
        <span className="cm-pv-tag">
          <Icon name={TYPE_ICON[row.tagType] ?? "tag"} size={13} />
          {row.tagName}
          <span className="cm-hist-lang">{row.locale.toUpperCase()}</span>
        </span>
        <span className="cm-hist-change">
          {row.current && row.current !== row.value && <s>{row.current}</s>}
          {row.current && row.current !== row.value && <Icon name="arrow-right" size={13} />}
          <b>{row.value}</b>
        </span>
      </span>
      <span className="cm-pv-status" style={{ "--c": STATUS_COLOR[row.status] } as CSSProperties}>
        {t(`community.pv.${row.status}`)}
      </span>
    </>
  );
  return onToggle ? (
    <button type="button" className={checked ? "cm-pv is-checked" : "cm-pv"} onClick={onToggle}>
      {body}
    </button>
  ) : (
    <div className="cm-pv">{body}</div>
  );
}

function PreviewSummary({ summary }: { summary: Partial<Record<PreviewStatus, number>> }) {
  const { t } = useI18n();
  return (
    <div className="cm-pv-summary">
      {(["new", "change", "same", "unknown", "locked"] as const).map((k) =>
        summary[k] ? (
          <span key={k} className="cm-pv-status" style={{ "--c": STATUS_COLOR[k] } as CSSProperties}>
            {t(`community.pv.${k}`)} · {summary[k]}
          </span>
        ) : null,
      )}
    </div>
  );
}

function FilesMode({ locale: initialLocale, onOpenSubmission, reloadKey }: { locale: TranslationLocale; onOpenSubmission: (id: number) => void; reloadKey: number }) {
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  const me = useMe();
  const rights = useRights();
  // Скачать
  const [locale, setLocale] = useState<TranslationLocale | "all">(initialLocale);
  const [status, setStatus] = useState<TranslationStatus>("missing");
  const [types, setTypes] = useState<TranslationTagType[]>([]);
  const [sort, setSort] = useState<TranslationSort>("popular");
  const [limit, setLimit] = useState<FileLimit>("500");
  const [downloading, setDownloading] = useState(false);
  // Загрузить
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Разобранный файл (только изменения) — для «применить сразу» модератором
  const [compact, setCompact] = useState<CompactFile | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number; upserted: number; kept: number } | null>(null);
  // Мои заявки
  const [mine, setMine] = useState<Submission[] | null>(null);

  const loadMine = useCallback(() => {
    if (!me) return setMine([]);
    getSubmissions(me.id, "mine").then(setMine, () => setMine([]));
  }, [me]);
  useEffect(loadMine, [loadMine, reloadKey]);

  const download = async () => {
    setDownloading(true);
    try {
      const f = await downloadTranslationFile({ locale, status, tagTypes: types, sort, limit: limit === "all" ? "all" : Number(limit) });
      if (!f.rows) return showToast({ type: "info", title: t("community.fileEmpty") });
      const message = savedMessage(await saveTextFile(f.fileName, "text/csv", f.text), t, f.rows);
      if (message) showToast({ type: "success", title: message });
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    } finally {
      setDownloading(false);
    }
  };

  const pick = async (picked: File | undefined) => {
    if (!picked || !me) return;
    setPreview(null);
    setCompact(null);
    setBulk(null);
    setShowAll(false);
    setChecking(true);
    try {
      const c = compactTranslationFile(await picked.text());
      if (c.badHeader) throw new Error(t("community.fileBadHeader"));
      if (!c.lines.length) {
        showToast({ type: "info", title: t("community.fileNothing"), message: t("community.fileNoChanges", { filled: c.filled }) });
        return;
      }
      if (c.lines.length > UPLOAD_MAX_ROWS && !rights.isModerator) throw new Error(t("community.errFileBig", { limit: UPLOAD_MAX_ROWS }) + ` (${c.lines.length})`);
      setCompact(c);
      // На сервер — только изменённые строки, под исходным именем; большой файл — предпросмотр первых строк
      const f = new File([toCsv(c.lines.slice(0, UPLOAD_MAX_ROWS))], picked.name, { type: "text/csv" });
      setFile(f);
      setPreview(await previewTranslationFile(me.id, f));
    } catch (e) {
      setFile(null);
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    } finally {
      setChecking(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setCompact(null);
    setBulk(null);
    setNote("");
  };

  /** Модератор: применить весь файл сразу, частями, с прогрессом. */
  const applyNow = async () => {
    if (!compact || !me || bulk) return;
    const total = compact.lines.length;
    if (!window.confirm(t(overwrite ? "community.bulkConfirmOverwrite" : "community.bulkConfirm", { count: total }))) return;
    const state = { done: 0, total, upserted: 0, kept: 0 };
    setBulk({ ...state });
    try {
      for (let i = 0; i < total; i += BULK_CHUNK) {
        const lines = compact.lines.slice(i, i + BULK_CHUNK);
        const res = await applyTranslationChunk(me.id, toCsv(lines), overwrite ? compact.keys.slice(i, i + BULK_CHUNK) : null);
        state.done += lines.length;
        state.upserted += res.upserted ?? 0;
        state.kept += res.conflictsKeptOld ?? 0;
        setBulk({ ...state });
      }
      showToast({ type: "success", title: t("community.bulkDone", { upserted: state.upserted, kept: state.kept }) });
      reset();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: `${communityErrorText(e, t)} · ${t("community.bulkStopped", { done: state.done, total })}` });
      setBulk(null);
    }
  };

  const submit = async () => {
    if (!file || !me || sending) return;
    setSending(true);
    try {
      const sub = await submitTranslationFile(me.id, file, note);
      showToast({ type: "success", title: t("community.submitted", { id: sub.id }) });
      reset();
      loadMine();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    } finally {
      setSending(false);
    }
  };

  const useful = preview ? preview.rows.filter((r) => r.status === "new" || r.status === "change") : [];
  const other = preview ? preview.rows.filter((r) => r.status !== "new" && r.status !== "change") : [];
  const shownRows = showAll ? [...useful, ...other] : useful.slice(0, PREVIEW_SHOWN);

  return (
    <>
      <ListGroup title={t("community.fileDownload")} padded>
        <div className="cm-file-form">
          <div className="cm-mod-row">
            <span className="cm-mod-label">{t("community.fileLang")}</span>
            <Segment
              value={locale}
              onChange={setLocale}
              options={[...TRANSLATION_LOCALES.map((l) => ({ key: l as TranslationLocale | "all", label: l.toUpperCase() })), { key: "all" as const, label: t("community.promptAll") }]}
            />
            {locale === "all" && <span className="cm-field-audit">{t("community.fileAllLangs")}</span>}
          </div>
          <div className="cm-mod-row">
            <span className="cm-mod-label">{t("community.status")}</span>
            <Segment
              value={status}
              onChange={setStatus}
              options={[
                { key: "missing", label: locale === "all" ? t("community.statusMissingAny") : t("community.statusMissing", { lang: locale.toUpperCase() }) },
                { key: "all", label: t("community.statusAll") },
                { key: "done", label: t("community.statusDone") },
              ]}
            />
          </div>
          <div className="cm-mod-row">
            <span className="cm-mod-label">{t("community.fileTypes")}</span>
            <div className="cm-chips is-wrap">
              {TRANSLATION_TAG_TYPES.map((x) => {
                const on = types.includes(x);
                return (
                  <button key={x} type="button" className={on ? "cm-chip is-active" : "cm-chip"} onClick={() => setTypes(on ? types.filter((y) => y !== x) : [...types, x])}>
                    <Icon name={TYPE_ICON[x]} size={14} />
                    {t(`community.types.${x}`)}
                  </button>
                );
              })}
            </div>
            {!types.length && <span className="cm-field-audit">{t("community.fileAllTypes")}</span>}
          </div>
          <div className="cm-toolbar is-wrap">
            <div className="cm-mod-row">
              <span className="cm-mod-label">{t("community.sort")}</span>
              <Segment
                value={sort}
                onChange={setSort}
                options={[
                  { key: "popular", label: t("community.sortPopular") },
                  { key: "name", label: t("community.sortName") },
                ]}
              />
            </div>
            <div className="cm-mod-row">
              <span className="cm-mod-label">{t("community.fileCount")}</span>
              <Segment value={limit} onChange={setLimit} options={FILE_LIMITS.map((n) => ({ key: n, label: n === "all" ? t("community.promptAll") : n }))} />
              {limit === "all" && <span className="cm-field-audit">{t("community.fileAllHint")}</span>}
            </div>
          </div>
          <button type="button" className="ax-btn ax-btn-primary" disabled={downloading} onClick={() => void download()}>
            {downloading ? <Spinner size={18} /> : <Icon name="download" size={18} />}
            {t("community.fileDownloadBtn")}
          </button>
        </div>
      </ListGroup>
      <ListHint>{t("community.fileHowTo")}</ListHint>
      <ListGroup>
        <AiPromptRow key={locale} initialLocale={locale} />
      </ListGroup>

      <ListGroup title={t("community.fileUpload")} padded>
        {!me ? (
          <div className="cm-file-form">
            <p className="cm-empty is-small">{t("community.fileLogin")}</p>
            <button type="button" className="ax-btn ax-btn-ghost" onClick={openLogin}>
              {t("community.loginToEdit")}
            </button>
          </div>
        ) : rights.banned ? (
          <p className="cm-empty is-small">{t("community.banned")}</p>
        ) : !file ? (
          <div className="cm-file-form">
            <button type="button" className="cm-drop" onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={26} />
              <span>{t("community.filePick")}</span>
              <small>{t("community.filePickSub")}</small>
            </button>
          </div>
        ) : (
          <div className="cm-file-form">
            <div className="cm-file-name">
              <Icon name="file-text" size={18} />
              <span>{file.name}</span>
              <button type="button" className="ax-icon-btn" aria-label={t("common.reset")} onClick={reset}>
                <Icon name="x" size={18} />
              </button>
            </div>
            {checking && (
              <div className="cm-loading">
                <Spinner size={22} />
              </div>
            )}
            {preview && (
              <>
                <PreviewSummary summary={preview.summary} />
                {preview.errors.length > 0 && (
                  <details className="cm-pv-errors">
                    <summary>{t("community.fileErrors", { count: preview.errors.length })}</summary>
                    {preview.errors.map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                  </details>
                )}
                {useful.length ? (
                  <div className="cm-pv-list">
                    {shownRows.map((r) => (
                      <PreviewRowView key={r.key} row={r} />
                    ))}
                    {(other.length > 0 || useful.length > PREVIEW_SHOWN) && !showAll && (
                      <button type="button" className="ax-btn ax-btn-ghost cm-more" onClick={() => setShowAll(true)}>
                        {t("community.fileShowAll", { count: preview.rows.length })}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="cm-empty is-small">{t("community.fileNothing")}</p>
                )}
                {compact && (compact.lines.length > UPLOAD_MAX_ROWS || compact.sameAsOriginal > 0) && (
                  <ListHint>
                    {t("community.bulkSummary", {
                      count: compact.lines.length,
                      langs: Object.entries(compact.byLocale)
                        .map(([l, n]) => `${l.toUpperCase()} ${n}`)
                        .join(", "),
                      same: compact.sameAsOriginal,
                    })}
                    {compact.lines.length > UPLOAD_MAX_ROWS && ` ${t("community.bulkPreviewPart", { count: UPLOAD_MAX_ROWS })}`}
                  </ListHint>
                )}
                {rights.isModerator && compact && (
                  <div className="cm-bulk">
                    <button type="button" className="cm-bulk-opt" onClick={() => setOverwrite((v) => !v)} disabled={!!bulk}>
                      <Icon name={overwrite ? "check-square" : "square"} size={18} />
                      <span>
                        <b>{t("community.bulkOverwrite")}</b>
                        <small>{t("community.bulkOverwriteSub")}</small>
                      </span>
                    </button>
                    {bulk && (
                      <div className="cm-bulk-progress">
                        <span className="cm-progress-bar">
                          <span style={{ width: `${(bulk.done / bulk.total) * 100}%` }} />
                        </span>
                        <small>{t("community.bulkProgress", { done: bulk.done, total: bulk.total, upserted: bulk.upserted })}</small>
                      </div>
                    )}
                    <button type="button" className="ax-btn ax-btn-primary" disabled={!!bulk} onClick={() => void applyNow()}>
                      {bulk ? <Spinner size={18} /> : <Icon name="check" size={18} />}
                      {t("community.bulkApply", { count: compact.lines.length })}
                    </button>
                  </div>
                )}
                {useful.length > 0 && (!compact || compact.lines.length <= UPLOAD_MAX_ROWS) && (
                  <>
                    <label className="cm-field">
                      <span className="cm-field-lang">
                        <Icon name="message-square" size={16} />
                      </span>
                      <span className="cm-field-body">
                        <input value={note} maxLength={500} placeholder={t("community.fileNote")} onChange={(e) => setNote(e.target.value)} />
                      </span>
                    </label>
                    <button type="button" className="ax-btn ax-btn-primary" disabled={sending} onClick={() => void submit()}>
                      {sending ? <Spinner size={18} /> : <Icon name="send" size={18} />}
                      {t("community.fileSubmit", { count: useful.length })}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </ListGroup>

      {me && (
        <ListGroup title={t("community.mySubmissions")}>
          {mine == null ? (
            <div className="cm-loading">
              <Spinner size={20} />
            </div>
          ) : mine.length ? (
            mine.map((s) => <SubmissionRow key={s.id} sub={s} resolved={resolved} onPress={() => onOpenSubmission(s.id)} />)
          ) : (
            <p className="cm-empty is-small">{t("community.noSubmissions")}</p>
          )}
        </ListGroup>
      )}
    </>
  );
}

function SubmissionRow({ sub, resolved, onPress, showAuthor }: { sub: Submission; resolved: ResolvedLocale; onPress: () => void; showAuthor?: boolean }) {
  const { t } = useI18n();
  return (
    <button type="button" className="set-row cm-tag-row" onClick={onPress}>
      <TileIcon icon={SUBMISSION_ICON[sub.status]} color={SUBMISSION_COLOR[sub.status]} size={20} />
      <span className="set-row-text">
        <span className="set-row-title">
          {showAuthor ? sub.username : t("community.submissionTitle", { id: sub.id })} · {t(`community.sub.${sub.status}`)}
        </span>
        <span className="set-row-sub">
          {t("community.submissionCounts", { new: sub.summary.new ?? 0, change: sub.summary.change ?? 0 })}
          {sub.status === "partial" || sub.status === "approved" ? ` · ${t("community.submissionApplied", { count: sub.applied })}` : ""} · {timeAgo(sub.createdAt, resolved)}
          {sub.note ? ` · ${sub.note}` : ""}
        </span>
      </span>
      <span className="set-row-trail">
        <Icon name="chevron-right" size={18} />
      </span>
    </button>
  );
}

/** Шторка заявки: строки с текущими значениями; модератор отмечает, что принять, автор может отозвать. */
function SubmissionSheet({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  const rights = useRights();
  const me = useMe();
  const [data, setData] = useState<{ info: Submission; rows: PreviewRow[] } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id == null || !me) return;
    let alive = true;
    setData(null);
    setNote("");
    getSubmission(me.id, id).then(
      (d) => {
        if (!alive) return;
        setData(d);
        setChecked(new Set(d.rows.filter((r) => r.status === "new" || r.status === "change" || r.status === "locked").map((r) => r.key)));
      },
      (e) => alive && showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me]);

  const info = data?.info;
  const pending = info?.status === "pending";
  const canReview = rights.isModerator && pending;
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const act = async (fn: () => Promise<Submission>, message: (s: Submission) => string) => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await fn();
      showToast({ type: "success", title: message(s) });
      onChanged();
      onClose();
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: communityErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <NhModal visible={id != null} onClose={onClose} title={id != null ? t("community.submissionTitle", { id }) : undefined} heightPercent={0.92} className="cm-modal">
      <div className="cm-sheet">
        {!data ? (
          <div className="cm-loading">
            <Spinner size={22} />
          </div>
        ) : (
          <>
            <div className="cm-tag-meta">
              <span className="cm-chip" style={{ color: SUBMISSION_COLOR[data.info.status] }}>
                <Icon name={SUBMISSION_ICON[data.info.status]} size={14} />
                {t(`community.sub.${data.info.status}`)}
              </span>
              <span className="cm-chip">{data.info.username}</span>
              <span className="cm-chip">{timeAgo(data.info.createdAt, resolved)}</span>
              {data.info.reviewedBy && <span className="cm-chip">{t("community.reviewedBy", { name: data.info.reviewedBy })}</span>}
            </div>
            {data.info.note && <ListHint>{data.info.note}</ListHint>}
            {data.info.reviewNote && <ListHint>{t("community.reviewNote", { note: data.info.reviewNote })}</ListHint>}

            <PreviewSummary
              summary={data.rows.reduce<Partial<Record<PreviewStatus, number>>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})}
            />
            {canReview && (
              <div className="cm-toolbar">
                <button type="button" className="cm-chip" onClick={() => setChecked(new Set(data.rows.map((r) => r.key)))}>
                  {t("community.selectAll")}
                </button>
                <button type="button" className="cm-chip" onClick={() => setChecked(new Set())}>
                  {t("community.selectNone")}
                </button>
                <span className="cm-toolbar-note">{t("community.selected", { count: checked.size, total: data.rows.length })}</span>
              </div>
            )}
            <ListGroup>
              <div className="cm-pv-list is-flush">
                {data.rows.map((r) => (
                  <PreviewRowView key={r.key} row={r} checked={checked.has(r.key)} onToggle={canReview ? () => toggle(r.key) : undefined} />
                ))}
              </div>
            </ListGroup>

            {canReview && (
              <>
                <label className="cm-field">
                  <span className="cm-field-lang">
                    <Icon name="message-square" size={16} />
                  </span>
                  <span className="cm-field-body">
                    <input value={note} maxLength={500} placeholder={t("community.reviewNotePh")} onChange={(e) => setNote(e.target.value)} />
                  </span>
                </label>
                <div className="cm-actions">
                  <button
                    type="button"
                    className="ax-btn ax-btn-primary"
                    disabled={busy || !checked.size}
                    onClick={() =>
                      void act(
                        () => reviewSubmission(me!.id, data.info.id, "approve", checked.size === data.rows.length ? null : [...checked], note),
                        (s) => t("community.approved", { count: s.applied }),
                      )
                    }
                  >
                    <Icon name="check" size={18} />
                    {t("community.approveSelected", { count: checked.size })}
                  </button>
                  <button
                    type="button"
                    className="ax-btn ax-btn-ghost cm-danger"
                    disabled={busy}
                    onClick={() => void act(() => reviewSubmission(me!.id, data.info.id, "reject", null, note), () => t("community.rejected"))}
                  >
                    {t("community.reject")}
                  </button>
                </div>
              </>
            )}
            {pending && !canReview && data.info.userId === me?.id && (
              <button type="button" className="ax-btn ax-btn-ghost" disabled={busy} onClick={() => void act(() => withdrawSubmission(me!.id, data.info.id), () => t("community.withdrawn"))}>
                <Icon name="corner-up-left" size={18} />
                {t("community.withdraw")}
              </button>
            )}
          </>
        )}
      </div>
    </NhModal>
  );
}

/** Модератору: заявки, ждущие рассмотрения. */
function PendingSubmissions({ onOpen, reloadKey }: { onOpen: (id: number) => void; reloadKey: number }) {
  const { t, resolved } = useI18n();
  const me = useMe();
  const [items, setItems] = useState<Submission[] | null>(null);
  useEffect(() => {
    if (!me) return;
    getSubmissions(me.id, "pending").then(setItems, () => setItems([]));
  }, [me, reloadKey]);
  return (
    <ListGroup title={t("community.pendingSubmissions", { count: items?.length ?? 0 })}>
      {items == null ? (
        <div className="cm-loading">
          <Spinner size={20} />
        </div>
      ) : items.length ? (
        items.map((s) => <SubmissionRow key={s.id} sub={s} resolved={resolved} showAuthor onPress={() => onOpen(s.id)} />)
      ) : (
        <p className="cm-empty is-small">{t("community.noPending")}</p>
      )}
    </ListGroup>
  );
}

// ─── Промт для нейросети ──────────────────────────────────────────────────────

const LANG_NAMES: Record<TranslationLocale, { ru: string; en: string }> = {
  en: { ru: "английский", en: "English" },
  ru: { ru: "русский", en: "Russian" },
  ja: { ru: "японский", en: "Japanese" },
  zh: { ru: "китайский (упрощённый)", en: "Simplified Chinese" },
};

type PromptTarget = TranslationLocale | "all";

/**
 * Готовый промт: перевести CSV из «Файлов» / «Выгрузки», не ломая формат (по-русски для русского интерфейса).
 * `all` — файл «Все переводы»: строка на каждый язык каждого тега, язык строки — в колонке locale.
 */
function aiPrompt(target: PromptTarget, uiRu: boolean): string {
  if (uiRu) {
    const lang = target === "all" ? "" : LANG_NAMES[target].ru;
    const intro =
      target === "all"
        ? "Я пришлю CSV-файл, переведи в нём теги на все языки из колонки locale: en — английский, ru — русский, ja — японский, zh — китайский (упрощённый)."
        : `Я пришлю CSV-файл, переведи в нём теги на ${lang} язык.`;
    const fill =
      target === "all"
        ? "- В файле по строке на каждый язык каждого тега. Заполняй translated_name в каждой строке на языке из её колонки locale. Если там уже есть перевод — оставь его как есть.\n- Переводы одного тега на разные языки должны означать одно и то же."
        : `- Заполняй только колонку translated_name в строках, где locale = ${target}. Если там уже есть перевод — оставь его как есть.`;
    return `Ты — переводчик тегов каталога додзинси и манги. ${intro}

Формат файла:
- Колонки: tag_type, tag_name, locale, translated_name (дальше могут быть hint_books, hint_en, hint_ru, hint_ja, hint_zh — это подсказки, их не меняй).
- tag_type — тип тега: tag (жанр/признак), artist (художник), group (группа/кружок), parody (тайтл-первоисточник), character (персонаж), category, language.
${fill}

Правила перевода:
- tag: короткий общепринятый термин, как его называют читатели на этом языке; без пояснений и кавычек. Устоявшиеся заимствования (юри, яой, футанари, ахегао) пиши так, как их принято писать.
- parody и character: официальное локализованное название/имя, если оно есть; если нет — общепринятая транслитерация. Порядок имени и фамилии — как принято в языке перевода.
- artist и group: это имена собственные — не переводи по смыслу; транслитерируй или оставь пустым, если не уверен.
- Подсказки hint_* помогают понять смысл; hint_books — сколько книг с тегом.
- Не уверен — оставь translated_name пустым, не выдумывай.

Вывод:
- Верни ТОЛЬКО CSV целиком: та же шапка, те же строки в том же порядке, первые три колонки без изменений.
- Значения с запятыми, кавычками или переносами строк бери в двойные кавычки ("", чтобы экранировать кавычку).
- Без пояснений, без markdown и без \`\`\` вокруг.

Если файл большой, переводи частями по 300 строк и пиши «продолжить», пока не закончишь.`;
  }
  const intro =
    target === "all"
      ? "I will send you a CSV file; translate its tags into every language listed in the locale column: en — English, ru — Russian, ja — Japanese, zh — Simplified Chinese."
      : `I will send you a CSV file; translate its tags into ${LANG_NAMES[target].en}.`;
  const fill =
    target === "all"
      ? "- The file has one row per language per tag. Fill in translated_name on every row in the language of its locale column. If a translation is already there, keep it.\n- Translations of the same tag into different languages must mean the same thing."
      : `- Fill in only the translated_name column on rows where locale = ${target}. If a translation is already there, keep it.`;
  return `You are a translator of tags for a doujinshi and manga catalog. ${intro}

File format:
- Columns: tag_type, tag_name, locale, translated_name (there may be more after them: hint_books, hint_en, hint_ru, hint_ja, hint_zh — these are hints, do not change them).
- tag_type is the tag kind: tag (genre/trait), artist, group (circle), parody (source work), character, category, language.
${fill}

Translation rules:
- tag: a short, commonly used term, the way readers of this language call it; no explanations or quotes. Established loanwords (yuri, yaoi, futanari, ahegao) are written the usual way.
- parody and character: the official localized title/name if one exists; otherwise the common romanization. Use the name order customary for the target language.
- artist and group: these are proper names — don't translate their meaning; transliterate, or leave empty if unsure.
- hint_* columns help with meaning; hint_books is how many books use the tag.
- If unsure, leave translated_name empty — don't make things up.

Output:
- Return ONLY the full CSV: same header, same rows in the same order, first three columns unchanged.
- Wrap values containing commas, quotes or line breaks in double quotes (use "" to escape a quote).
- No explanations, no markdown, no \`\`\` fences.

If the file is large, translate it in chunks of 300 rows and I'll say "continue" until you're done.`;
}

/** Пункт списка и шторка с промтом: выбрать язык, посмотреть, скопировать. */
function AiPromptRow({ initialLocale }: { initialLocale: PromptTarget }) {
  const { t, resolved } = useI18n();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<PromptTarget>(initialLocale);
  const text = aiPrompt(target, resolved === "ru");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ type: "success", title: t("community.promptCopied") });
    } catch (e) {
      showToast({ type: "error", title: t("toast.errorTitle"), message: errorText(e) });
    }
  };

  return (
    <>
      <ListRow icon="message-square" color="#8e6cf0" title={t("community.prompt")} sub={t("community.promptSub")} onPress={() => setOpen(true)} />
      <NhModal visible={open} onClose={() => setOpen(false)} title={t("community.prompt")} heightPercent={0.92} className="cm-modal">
        <div className="cm-sheet cm-prompt">
          <div className="cm-mod-row">
            <span className="cm-mod-label">{t("community.promptLang")}</span>
            <Segment
              value={target}
              onChange={setTarget}
              options={[...TRANSLATION_LOCALES.map((l) => ({ key: l as PromptTarget, label: l.toUpperCase() })), { key: "all" as PromptTarget, label: t("community.promptAll") }]}
            />
          </div>
          <ListHint>{t("community.promptHow")}</ListHint>
          <ListGroup title={t("community.descHowTitle")} padded>
            <p className="cm-how">{t("community.descHow")}</p>
          </ListGroup>
          <pre className="cm-prompt-text">{text}</pre>
          <div className="cm-actions">
            <button type="button" className="ax-btn ax-btn-primary" onClick={() => void copy()}>
              <Icon name="copy" size={18} />
              {t("community.promptCopy")}
            </button>
          </div>
        </div>
      </NhModal>
    </>
  );
}
