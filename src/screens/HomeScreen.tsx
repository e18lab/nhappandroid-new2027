/**
 * Главная — редизайн в духе Anixart. Сверху вкладки, листаются свайпом вбок:
 * «Новое» (каталог с бесконечной подгрузкой; сортировка — в фильтрах у поиска),
 * на ПК — «Сообщество» (страница выбирается в выпадающем меню вкладки; на телефоне это раздел нижней панели),
 * «Рекомендации»,
 * дальше разделы библиотеки: загруженное, закладки, онлайн-избранное (после входа), история, теги.
 * Открытый раздел запоминается (`ui.home.tab`) — у каждой вкладки браузера свой, синхронизируется с другими устройствами.
 * На ПК полоса вкладок — в заголовке окна (`DesktopChrome.tsx`), здесь только лента страниц.
 *
 * С `?query=` (результаты поиска) — одна лента с сортировкой из фильтров, как раньше.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useBoundValue, useTabActive } from "../browser/tabs";
import { CatalogFeed } from "../components/CatalogFeed";
import { useI18n } from "../i18n/I18nContext";
import { IS_DESKTOP } from "../lib/platform";
import { useMe } from "../lib/session";
import { getItem, setItem, subscribeKey } from "../lib/storage";
import { PageTabs, Pager, usePager } from "../ui";
import { CommunityPage, useCommunityMenu } from "./CommunityScreen";
import { FavoritesOnlineScreen } from "./FavoritesOnlineScreen";
import { getDeskPager, HOME_TAB_KEY, homeTabs, setDeskPager } from "./homeTabs";
import { DownloadedScreen, SavedScreen } from "./LibraryScreens";
import { RecommendationsScreen } from "./RecommendationsScreen";
import { TagsScreen } from "./TagsScreen";

/** Страница, которой не важно, открыта ли она: один и тот же элемент, и React не считает её заново при смене вкладки. */
const page = (node: ReactNode) => () => node;

const PAGES: Record<string, (active: boolean) => ReactNode> = {
  latest: page(<CatalogFeed />),
  community: page(<CommunityPage />),
  recommendations: (active) => <RecommendationsScreen active={active} />,
  downloaded: page(<DownloadedScreen />),
  favorites: page(<SavedScreen kind="favorites" />),
  online: page(<FavoritesOnlineScreen />),
  history: page(<SavedScreen kind="history" />),
  tags: page(<TagsScreen />),
};

export function HomeScreen() {
  const [params] = useSearchParams();
  const me = useMe();
  const query = params.get("query") ?? "";
  if (query.trim()) return <CatalogFeed query={query} />;
  // Набор вкладок зависит от входа — при входе/выходе ленту собираем заново
  return <HomePager key={me ? "in" : "out"} loggedIn={!!me} />;
}

function HomePager({ loggedIn }: { loggedIn: boolean }) {
  const { t } = useI18n();
  const tabs = homeTabs(loggedIn, IS_DESKTOP);
  const saved = tabs.findIndex((x) => x.key === (getItem(HOME_TAB_KEY) ?? "latest"));
  const pager = usePager(tabs.length, saved >= 0 ? saved : tabs.findIndex((x) => x.key === "latest"));
  const communityMenu = useCommunityMenu();

  // Раздел главной — свой у каждой вкладки и синхронизируется: сменили его на другом устройстве (или вернулись
  // во вкладку) — лента переходит туда же. В скрытой вкладке значение не меняется (useBoundValue)
  const wantKey = useBoundValue(useSyncExternalStore((cb) => subscribeKey(HOME_TAB_KEY, cb), () => getItem(HOME_TAB_KEY) ?? "latest"));
  useEffect(() => {
    const i = tabs.findIndex((x) => x.key === wantKey);
    if (i >= 0 && i !== pager.indexRef.current) pager.goTo(i);
  }, [wantKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ПК: полоса разделов в заголовке окна управляет лентой главной в выбранной вкладке браузера
  const tabActive = useTabActive();
  useEffect(() => {
    if (!IS_DESKTOP || !tabActive) return;
    setDeskPager(pager);
    return () => {
      if (getDeskPager() === pager) setDeskPager(null);
    };
  }, [pager, tabActive]);

  return (
    <div className="screen-fill ax-home">
      {!IS_DESKTOP && (
        <div className="ax-home-tabs">
          <PageTabs
            pager={pager}
            tabs={tabs.map((x) => ({ key: x.key, label: t(x.labelKey), menu: x.key === "community" ? communityMenu : undefined }))}
          />
        </div>
      )}
      <Pager pager={pager} count={tabs.length} onIndexChange={(i) => setItem(HOME_TAB_KEY, tabs[i].key)} render={(i, active) => PAGES[tabs[i].key](active)} />
    </div>
  );
}
