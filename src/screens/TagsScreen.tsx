/**
 * Теги и коллекции — перенос `app/tags/index.tsx` и `components/tags/*` (релиз 1.3.1).
 *
 * Сверху поиск по справочнику (`tagsDb`), вкладки «Все / Избранные / Коллекции».
 * Тап по тегу — цикл фильтра: нет → включить → исключить → нет; сердечко — в избранное.
 * «Выбранные» — включённые и исключённые теги: на телефоне в шторке, на планшете слева (320px).
 * Коллекция — сохранённый набор фильтров: тап заменяет текущие фильтры коллекцией.
 */
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { getTagFilters, setTagFilters, setTagMode, useBrowseFilters, type TagFilterItem } from "../lib/browseFilters";
import {
  deleteCollection,
  saveCollection,
  useTagCollections,
  useTagFavs,
  type CollectionItem,
  type TagCollection,
} from "../lib/tagLibrary";
import {
  findTag,
  loadTagsDb,
  searchTags,
  tagStub,
  toPlural,
  toSingular,
  type TagItem,
  type TagKind,
  type TagMode,
} from "../lib/tagsDb";
import { Icon, LoadingSpinner, NhModal, type IconName } from "../ui";

type MainTab = "all" | "favs" | "collections";
type Draft = { id: string | null; name: string; items: CollectionItem[] };

const TYPE_ICON: Record<TagKind, IconName> = {
  tags: "tag",
  artists: "pen-tool",
  characters: "user",
  parodies: "film",
  groups: "users",
};

const sameTag = (a: { type: string; name: string }, b: { type: string; name: string }) =>
  toPlural(a.type) === toPlural(b.type) && a.name === b.name;

function useIsTablet(): boolean {
  const check = () => {
    const shortest = Math.min(window.screen.width, window.screen.height);
    return window.innerWidth >= 900 || shortest >= 600;
  };
  const [tablet, setTablet] = useState(check);
  useEffect(() => {
    const onResize = () => setTablet(check());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return tablet;
}

/** Текущий режим фильтра для тега (тип в фильтрах хранится в единственном числе). */
function modeOf(filters: TagFilterItem[], t: { type: string; name: string }): TagMode | undefined {
  return filters.find((f) => sameTag(f, t))?.mode;
}

function setGlobal(t: { type: string; name: string; id?: number | string }, mode: TagMode | undefined) {
  const id = Number(t.id) || findTag(t.type, t.name)?.id;
  setTagMode(toSingular(t.type), t.name, mode ?? null, id || undefined);
}

/** Коллекция → фильтры (с id из справочника, если тег там есть). */
function applyCollection(c: TagCollection) {
  setTagFilters(
    c.items.map((it) => {
      const id = findTag(it.type, it.name)?.id;
      const item: TagFilterItem = { type: toSingular(it.type), name: it.name, mode: it.mode };
      if (id) item.id = id;
      return item;
    }),
  );
}

const filtersAsItems = (filters: TagFilterItem[]): CollectionItem[] =>
  filters.map((f) => ({ type: toPlural(f.type), name: f.name, mode: f.mode }));

/** Коллекция совпадает с текущими фильтрами (подсветка активной). */
function isActiveCollection(c: TagCollection, filters: TagFilterItem[]): boolean {
  if (filters.length !== c.items.length) return false;
  const canon = (type: string, name: string, mode: string) => `${toSingular(type)}:${name.toLowerCase()}:${mode}`;
  const have = new Set(filters.map((f) => canon(f.type, f.name, f.mode)));
  return c.items.every((it) => have.has(canon(it.type, it.name, it.mode)));
}

export function TagsScreen() {
  const { t } = useI18n();
  const tablet = useIsTablet();
  useBrowseFilters();
  const filters = getTagFilters();
  const { favs, isFav, toggleFav } = useTagFavs();
  const collections = useTagCollections();

  const [db, setDb] = useState<TagItem[] | null>(null);
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [tab, setTab] = useState<MainTab>("all");
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    void loadTagsDb().then(setDb);
  }, []);

  useEffect(() => {
    const h = window.setTimeout(() => setNeedle(q.trim().toLowerCase()), q.length < 3 ? 60 : 120);
    return () => window.clearTimeout(h);
  }, [q]);

  const list = useMemo(() => {
    if (!db) return [];
    const base = tab === "favs" ? db.filter((x) => favs[`${x.type}:${x.name}`]) : db;
    return searchTags(base, needle);
  }, [db, tab, favs, needle]);

  const shownCollections = useMemo(
    () => (needle ? collections.filter((c) => (c.name || "").toLowerCase().includes(needle)) : collections),
    [collections, needle],
  );

  const onTapTag = (item: TagItem) => {
    const curr = modeOf(filters, item);
    setGlobal(item, curr === undefined ? "include" : curr === "include" ? "exclude" : undefined);
  };

  const selected = (
    <SelectedPanel filters={filters} isFav={isFav} toggleFav={toggleFav} onClear={() => setTagFilters([])} />
  );

  return (
    <div className={tablet ? "tags-screen is-tablet" : "tags-screen"}>
      {tablet && <aside className="tags-sidebar">{selected}</aside>}
      <div className="tags-main">
        <div className="tags-search-row">
          <div className="tags-search">
            <Icon name="search" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t(tab === "collections" ? "tags.searchCollectionPlaceholder" : "tags.searchPlaceholder")}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            {!!q && (
              <button type="button" aria-label={t("common.reset")} onClick={() => setQ("")}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          {!tablet && (
            <button type="button" className="tags-selected-btn" onClick={() => setSheet(true)}>
              <Icon name="sliders" size={16} />
              <span>{t("tags.selected")}</span>
            </button>
          )}
        </div>

        <div className="tags-tabs">
          {(["all", "favs", "collections"] as MainTab[]).map((key) => (
            <button key={key} type="button" className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>
              {t(key === "all" ? "tags.all" : key === "favs" ? "tags.favs" : "tags.collectionsTab")}
            </button>
          ))}
        </div>

        {tab === "collections" ? (
          <div className="tags-list">
            <button
              type="button"
              className="tags-primary-btn"
              onClick={() => setDraft({ id: null, name: t("collections.defaultName"), items: filtersAsItems(filters) })}
            >
              {t("collections.createFromSelected")}
            </button>
            {shownCollections.length === 0 ? (
              <p className="tags-empty">{t("common.nothingFound")}</p>
            ) : (
              shownCollections.map((c) => (
                <div key={c.id} className={isActiveCollection(c, filters) ? "tags-collection is-active" : "tags-collection"}>
                  <button type="button" className="tags-collection-main" onClick={() => applyCollection(c)}>
                    <span className="tags-collection-title">{c.name || t("collections.untitled")}</span>
                    <span className="tags-collection-count">{t("collections.itemsCount", { count: c.items.length })}</span>
                  </button>
                  <button
                    type="button"
                    className="tags-icon-btn"
                    aria-label={t("collections.list.edit")}
                    onClick={() => setDraft({ id: c.id, name: c.name, items: c.items.map((x) => ({ ...x, type: toPlural(x.type) })) })}
                  >
                    <Icon name="edit-2" size={16} />
                  </button>
                  <button
                    type="button"
                    className="tags-icon-btn"
                    aria-label={t("collections.list.delete")}
                    onClick={() => deleteCollection(c.id)}
                  >
                    <Icon name="trash-2" size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : !db ? (
          <LoadingSpinner />
        ) : (
          <div className="tags-list">
            {list.length === 0 ? (
              <p className="tags-empty">{t("common.nothingFound")}</p>
            ) : (
              list.map((item) => {
                const mode = modeOf(filters, item);
                return (
                  <TagRow
                    key={`${item.type}:${item.id}:${item.name}`}
                    item={item}
                    mode={mode}
                    fav={isFav(item)}
                    onTap={() => onTapTag(item)}
                    onToggleFav={() => toggleFav(item)}
                    onRemove={mode ? () => setGlobal(item, undefined) : undefined}
                  />
                );
              })
            )}
          </div>
        )}
      </div>

      {!tablet && (
        <NhModal visible={sheet} onClose={() => setSheet(false)} sizing="fixed" title={t("tags.selected")}>
          {selected}
        </NhModal>
      )}

      {draft && (
        <CollectionEditor
          draft={draft}
          setDraft={setDraft}
          isFav={isFav}
          toggleFav={toggleFav}
          onCancel={() => setDraft(null)}
          onFromFilters={() => setDraft((d) => (d ? { ...d, items: filtersAsItems(getTagFilters()) } : d))}
          onSave={() => {
            saveCollection(draft.id, draft.name.trim() || t("collections.untitled"), draft.items);
            setDraft(null);
          }}
        />
      )}
    </div>
  );
}

function TagRow({
  item,
  mode,
  fav,
  onTap,
  onToggleFav,
  onRemove,
}: {
  item: TagItem;
  mode?: TagMode;
  fav: boolean;
  onTap: () => void;
  onToggleFav: () => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={`tag-row${mode ? ` is-${mode}` : ""}`} role="button" tabIndex={0} onClick={onTap}>
      <span className="tag-row-icon">
        <Icon name={TYPE_ICON[item.type] ?? "tag"} size={16} />
      </span>
      <span className="tag-row-text">
        <span className="tag-row-title">{item.name}</span>
        <span className="tag-row-meta">
          {t(`tags.kind.${item.type}`)} • {item.count.toLocaleString("en-US")}
        </span>
      </span>
      <button
        type="button"
        className={fav ? "tag-row-fav is-fav" : "tag-row-fav"}
        aria-pressed={fav}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav();
        }}
      >
        <Icon name="heart" size={16} />
      </button>
      {mode && onRemove && (
        <button
          type="button"
          className="tag-row-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

type FavFns = { isFav: (t: { type: string; name: string }) => boolean; toggleFav: (t: { type: string; name: string }) => void };

/** «Выбранные» — SidebarSelected: включённые, исключённые, сброс. Тап переключает Вкл/Искл. */
function SelectedPanel({ filters, isFav, toggleFav, onClear }: { filters: TagFilterItem[]; onClear: () => void } & FavFns) {
  const { t } = useI18n();
  const includes = filters.filter((f) => f.mode === "include");
  const excludes = filters.filter((f) => f.mode === "exclude");
  const rows = (list: TagFilterItem[], mode: TagMode) =>
    list.length === 0 ? (
      <p className="tags-empty is-small">{t("tags.empty")}</p>
    ) : (
      list.map((f) => (
        <TagRow
          key={`${f.type}:${f.name}`}
          item={tagStub(f.type, f.name)}
          mode={mode}
          fav={isFav(f)}
          onTap={() => setGlobal(f, mode === "include" ? "exclude" : "include")}
          onToggleFav={() => toggleFav(f)}
          onRemove={() => setGlobal(f, undefined)}
        />
      ))
    );

  return (
    <div className="tags-selected">
      <div className="tags-selected-head">
        <span className="tags-selected-title">{t("tags.selected")}</span>
        <span className="tags-counter is-include">✓ {includes.length}</span>
        <span className="tags-counter is-exclude">− {excludes.length}</span>
      </div>
      <div className="tags-selected-list">
        <span className="tags-subhead">{t("tags.included")}</span>
        {rows(includes, "include")}
        <span className="tags-subhead">{t("tags.excluded")}</span>
        {rows(excludes, "exclude")}
        <button type="button" className="tags-primary-btn" onClick={onClear}>
          <Icon name="refresh-ccw" size={16} />
          {t("common.reset")}
        </button>
      </div>
    </div>
  );
}

function CollectionEditor({
  draft,
  setDraft,
  isFav,
  toggleFav,
  onCancel,
  onSave,
  onFromFilters,
}: {
  draft: Draft;
  setDraft: (fn: (d: Draft | null) => Draft | null) => void;
  onCancel: () => void;
  onSave: () => void;
  onFromFilters: () => void;
} & FavFns) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"all" | TagMode>("all");
  const inc = draft.items.filter((x) => x.mode === "include").length;
  const exc = draft.items.length - inc;
  const shown = draft.items
    .filter((it) => mode === "all" || it.mode === mode)
    .sort((a, b) => a.name.localeCompare(b.name));

  const update = (fn: (items: CollectionItem[]) => CollectionItem[]) =>
    setDraft((d) => (d ? { ...d, items: fn(d.items) } : d));

  return (
    <NhModal
      visible
      onClose={onCancel}
      sizing="fixed"
      dimBackground={false}
      title={t(draft.id ? "collections.editTitle" : "collections.newTitle")}
      hint={t("collections.hint")}
      sheetStyle={{ background: "var(--page)" }}
    >
      <div className="col-editor">
        <div className="col-name">
          <Icon name="bookmark" size={16} />
          <input
            value={draft.name}
            placeholder={t("collections.namePlaceholder")}
            onChange={(e) => {
              const name = e.target.value;
              setDraft((d) => (d ? { ...d, name } : d));
            }}
          />
        </div>
        <div className="col-segments">
          {(["all", "include", "exclude"] as const).map((m) => (
            <button key={m} type="button" className={mode === m ? "is-active" : ""} onClick={() => setMode(m)}>
              {t(`collections.filter.${m}`)}
            </button>
          ))}
        </div>
        <div className="col-counters">
          <span>{t("collections.counters.included", { count: inc })}</span>
          <span>{t("collections.counters.excluded", { count: exc })}</span>
        </div>
        <div className="col-list">
          {shown.length === 0 ? (
            <p className="tags-empty is-small">{t("common.nothingFound")}</p>
          ) : (
            shown.map((it) => (
              <TagRow
                key={`${it.type}:${it.name}`}
                item={tagStub(it.type, it.name)}
                mode={it.mode}
                fav={isFav(it)}
                onTap={() =>
                  update((items) =>
                    items.map((x) => (sameTag(x, it) ? { ...x, mode: x.mode === "include" ? "exclude" : "include" } : x)),
                  )
                }
                onToggleFav={() => toggleFav(it)}
                onRemove={() => update((items) => items.filter((x) => !sameTag(x, it)))}
              />
            ))
          )}
        </div>
        <div className="col-footer">
          <button type="button" onClick={() => update(() => [])}>
            <Icon name="trash-2" size={16} />
            <span>{t("common.reset")}</span>
          </button>
          <button type="button" className="is-tag" onClick={onFromFilters}>
            <Icon name="download" size={16} />
            <span>{t("collections.fromSelected")}</span>
          </button>
          <button type="button" className="is-primary" onClick={onSave}>
            <Icon name="check" size={16} />
            <span>{t("common.save")}</span>
          </button>
        </div>
      </div>
    </NhModal>
  );
}
