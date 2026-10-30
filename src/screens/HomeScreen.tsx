/**
 * Главная — редизайн в духе Anixart. Сверху вкладки, листаются свайпом вбок:
 * «Моя» (вся библиотека списком), «Новое» (каталог с бесконечной подгрузкой; сортировка — в фильтрах слева),
 * дальше разделы библиотеки: загруженное, закладки, онлайн-избранное (после входа), история, теги.
 * Последняя открытая вкладка запоминается (`ui.home.tab`).
 *
 * С `?query=` (результаты поиска) — одна лента с сортировкой из фильтров, как раньше.
 */
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CatalogFeed } from "../components/CatalogFeed";
import { LibraryList } from "../components/LibraryList";
import { useI18n } from "../i18n/I18nContext";
import { useMe } from "../lib/session";
import { getItem, setItem } from "../lib/storage";
import { CatalogFilterButton } from "../shell/CatalogFilter";
import { Icon, PageTabs, Pager, usePager } from "../ui";
import { FavoritesOnlineScreen } from "./FavoritesOnlineScreen";
import { DownloadedScreen, SavedScreen } from "./LibraryScreens";
import { TagsScreen } from "./TagsScreen";

const TAB_KEY = "ui.home.tab";

const TABS: { key: string; labelKey: string; needsLogin?: boolean; render: () => ReactNode }[] = [
  { key: "my", labelKey: "home.tabs.my", render: () => <MyPage /> },
  { key: "latest", labelKey: "home.tabs.latest", render: () => <CatalogFeed /> },
  { key: "downloaded", labelKey: "menu.downloaded", render: () => <DownloadedScreen /> },
  { key: "favorites", labelKey: "menu.favorites", render: () => <SavedScreen kind="favorites" /> },
  { key: "online", labelKey: "menu.favoritesOnline", needsLogin: true, render: () => <FavoritesOnlineScreen /> },
  { key: "history", labelKey: "menu.history", render: () => <SavedScreen kind="history" /> },
  { key: "tags", labelKey: "menu.tags", render: () => <TagsScreen /> },
];

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
  const tabs = TABS.filter((x) => !x.needsLogin || loggedIn);
  const saved = tabs.findIndex((x) => x.key === (getItem(TAB_KEY) ?? "latest"));
  const pager = usePager(tabs.length, saved >= 0 ? saved : 1);

  return (
    <div className="screen-fill ax-home">
      <div className="ax-home-tabs">
        <PageTabs
          pager={pager}
          tabs={tabs.map((x) => ({ key: x.key, label: t(x.labelKey) }))}
          leading={
            <CatalogFilterButton
              trigger={({ onPress }) => (
                <button type="button" className="ax-tabs-btn" aria-label={t("explore.filter.sortTitle")} onClick={onPress}>
                  <Icon name="sliders" size={20} />
                </button>
              )}
            />
          }
        />
      </div>
      <Pager pager={pager} count={tabs.length} onIndexChange={(i) => setItem(TAB_KEY, tabs[i].key)} render={(i) => tabs[i].render()} />
    </div>
  );
}

/** Вкладка «Моя» — вся библиотека списком. */
function MyPage() {
  return (
    <div className="screen-scroll ax-my">
      <LibraryList />
    </div>
  );
}
