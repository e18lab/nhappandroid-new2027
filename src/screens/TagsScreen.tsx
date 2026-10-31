/**
 * Теги, избранные и коллекции — на новом ките (карточки-группы как в настройках, поиск и сегменты
 * как в «Сообществе»). На телефоне — страница, на планшете и ПК — окном поверх экрана (`Shell.tsx`).
 *
 * Сверху поиск по справочнику (`tagsDb`) — и по оригиналу, и по переводу сообщества на язык интерфейса
 * (`tagTranslations.ts`, если включено «Теги на языке интерфейса»), сегменты «Все / Избранные / Коллекции»
 * и типы тегов. Тап по тегу — цикл фильтра: нет → включить → исключить → нет; сердечко — в избранное.
 * «Выбрано» — включённые и исключённые чипами: тап меняет Вкл/Искл, крестик убирает, можно сохранить в коллекцию.
 * Коллекция — сохранённый набор фильтров: тап заменяет текущие фильтры коллекцией.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import { useTagLabel } from "../lib/tagTranslations";
import { TAG_KINDS, findTag, loadTagsDb, tagStub, toPlural, toSingular, type TagItem, type TagKind, type TagMode } from "../lib/tagsDb";
import { Icon, ListGroup, ListHint, ListRow, LoadingSpinner, NhModal, type IconName } from "../ui";

type MainTab = "all" | "favs" | "collections";
type KindFilter = "all" | TagKind;
type Draft = { id: string | null; name: string; items: CollectionItem[] };
type FavFns = { isFav: (t: { type: string; name: string }) => boolean; toggleFav: (t: { type: string; name: string }) => void };
type Label = (type: string, name: string) => string;

const LIMIT = 200;

const KIND_ICON: Record<TagKind, IconName> = {
  tags: "tag",
  artists: "pen-tool",
  characters: "user",
  parodies: "film",
  groups: "users",
};

/** Цвет плитки типа — как цвета чипов на карточках книг. */
const KIND_COLOR: Record<TagKind, string> = {
  tags: "#8e8e93",
  artists: "#f59e0b",
  characters: "#3b82f6",
  parodies: "#a855f7",
  groups: "#14b8a6",
};

const sameTag = (a: { type: string; name: string }, b: { type: string; name: string }) =>
  toPlural(a.type) === toPlural(b.type) && a.name === b.name;

function modeOf(filters: TagFilterItem[], t: { type: string; name: string }): TagMode | undefined {
  return filters.find((f) => sameTag(f, t))?.mode;
}

function setGlobal(t: { type: string; name: string; id?: number | string }, mode: TagMode | undefined) {
  const id = Number(t.id) || findTag(t.type, t.name)?.id;
  setTagMode(toSingular(t.type), t.name, mode ?? null, id || undefined);
}

const nextMode = (m: TagMode | undefined): TagMode | undefined => (m === undefined ? "include" : m === "include" ? "exclude" : undefined);

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

function isActiveCollection(c: TagCollection, filters: TagFilterItem[]): boolean {
  if (filters.length !== c.items.length) return false;
  const canon = (type: string, name: string, mode: string) => `${toSingular(type)}:${name.toLowerCase()}:${mode}`;
  const have = new Set(filters.map((f) => canon(f.type, f.name, f.mode)));
  return c.items.every((it) => have.has(canon(it.type, it.name, it.mode)));
}

/** Релевантность: начало имени, начало слова, вхождение; при равенстве — популярность. */
function score(low: string, needle: string): number {
  if (low.startsWith(needle)) return 3;
  if (low.includes(` ${needle}`)) return 2;
  return low.includes(needle) ? 1 : 0;
}

export function TagsScreen() {
  const { t } = useI18n();
  useBrowseFilters();
  const filters = getTagFilters();
  const { favs, isFav, toggleFav } = useTagFavs();
  const collections = useTagCollections();
  const label = useTagLabel();

  const [db, setDb] = useState<TagItem[] | null>(null);
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [tab, setTab] = useState<MainTab>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    void loadTagsDb().then(setDb);
  }, []);

  useEffect(() => {
    const h = window.setTimeout(() => setNeedle(q.trim().toLowerCase()), q.length < 3 ? 60 : 120);
    return () => window.clearTimeout(h);
  }, [q]);

  // Перевод каждого тега (только где он есть) — для показа и поиска на языке интерфейса
  const translated = useMemo(() => {
    const map = new Map<TagItem, string>();
    for (const item of db ?? []) {
      const l = label(toSingular(item.type), item.name);
      if (l !== item.name) map.set(item, l);
    }
    return map;
  }, [db, label]);

  const list = useMemo(() => {
    if (!db) return [];
    let base = db;
    if (tab === "favs") base = base.filter((x) => favs[`${x.type}:${x.name}`]);
    if (kind !== "all") base = base.filter((x) => x.type === kind);
    if (!needle) return base.slice(0, LIMIT);
    const scored: { item: TagItem; s: number }[] = [];
    for (const item of base) {
      const s = Math.max(score(item.low, needle), score(translated.get(item)?.toLowerCase() ?? "", needle));
      if (s) scored.push({ item, s });
    }
    scored.sort((a, b) => b.s - a.s || b.item.count - a.item.count);
    return scored.slice(0, LIMIT).map((x) => x.item);
  }, [db, tab, kind, favs, needle, translated]);

  const shownCollections = useMemo(
    () => (needle ? collections.filter((c) => (c.name || "").toLowerCase().includes(needle)) : collections),
    [collections, needle],
  );

  const newCollection = () => setDraft({ id: null, name: t("collections.defaultName"), items: filtersAsItems(filters) });

  return (
    <div className="screen-scroll tg-page">
      <SearchPill
        value={q}
        onChange={setQ}
        placeholder={t(tab === "collections" ? "tags.searchCollectionPlaceholder" : "tags.searchPlaceholder")}
      />

      <div className="cm-seg tg-seg" role="radiogroup">
        {(["all", "favs", "collections"] as MainTab[]).map((key) => (
          <button key={key} type="button" role="radio" aria-checked={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>
            {t(key === "all" ? "tags.all" : key === "favs" ? "tags.favs" : "tags.collectionsTab")}
          </button>
        ))}
      </div>

      {tab !== "collections" && (
        <div className="cm-chips tg-kinds">
          {(["all", ...TAG_KINDS] as KindFilter[]).map((k) => (
            <button key={k} type="button" className={kind === k ? "cm-chip is-active" : "cm-chip"} onClick={() => setKind(k)}>
              {k !== "all" && <Icon name={KIND_ICON[k]} size={14} />}
              {k === "all" ? t("tagsPage.allKinds") : t(`tags.${k}`)}
            </button>
          ))}
        </div>
      )}

      {filters.length > 0 && (
        <SelectedGroup filters={filters} label={label} onSave={newCollection} />
      )}

      {tab === "collections" ? (
        <>
          <ListGroup>
            <ListRow
              icon="plus"
              color="#4cae5b"
              title={t("collections.createFromSelected")}
              sub={filters.length ? t("tagsPage.counts", { inc: count(filters, "include"), exc: count(filters, "exclude") }) : t("tagsPage.nothingSelected")}
              onPress={newCollection}
            />
          </ListGroup>
          {shownCollections.length === 0 ? (
            <p className="cm-empty">{needle ? t("common.nothingFound") : t("tagsPage.noCollections")}</p>
          ) : (
            <ListGroup title={t("tags.collectionsTab")}>
              {shownCollections.map((c) => (
                <CollectionRow
                  key={c.id}
                  c={c}
                  active={isActiveCollection(c, filters)}
                  onApply={() => applyCollection(c)}
                  onEdit={() => setDraft({ id: c.id, name: c.name, items: c.items.map((x) => ({ ...x, type: toPlural(x.type) })) })}
                  onDelete={() => deleteCollection(c.id)}
                />
              ))}
            </ListGroup>
          )}
        </>
      ) : !db ? (
        <div className="cm-loading">
          <LoadingSpinner />
        </div>
      ) : list.length === 0 ? (
        <p className="cm-empty">{tab === "favs" && !needle ? t("tagsPage.noFavs") : t("common.nothingFound")}</p>
      ) : (
        <>
          <ListGroup>
            {list.map((item) => (
              <TagRow
                key={`${item.type}:${item.id}:${item.name}`}
                item={item}
                title={translated.get(item) ?? item.name}
                mode={modeOf(filters, item)}
                fav={isFav(item)}
                onTap={() => setGlobal(item, nextMode(modeOf(filters, item)))}
                onToggleFav={() => toggleFav(item)}
              />
            ))}
          </ListGroup>
          <ListHint>{t("tagsPage.hint")}</ListHint>
        </>
      )}

      {draft && (
        <CollectionEditor
          draft={draft}
          setDraft={setDraft}
          isFav={isFav}
          toggleFav={toggleFav}
          label={label}
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

const count = (items: { mode: TagMode }[], mode: TagMode) => items.filter((x) => x.mode === mode).length;

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

/** Строка тега: плитка типа (включён — зелёная с галкой, исключён — красная с минусом), имя, оригинал и число книг. */
function TagRow({
  item,
  title,
  mode,
  fav,
  onTap,
  onToggleFav,
  onRemove,
}: {
  item: TagItem;
  title: string;
  mode?: TagMode;
  fav: boolean;
  onTap: () => void;
  onToggleFav: () => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const sub = [title !== item.name ? item.name : "", t(`tags.kind.${item.type}`), item.count ? item.count.toLocaleString("en-US") : ""].filter(Boolean).join(" · ");
  const icon: IconName = mode === "include" ? "check" : mode === "exclude" ? "minus" : (KIND_ICON[item.type] ?? "tag");
  return (
    <div className={`set-row tg-row${mode ? ` is-${mode}` : ""}`} role="button" tabIndex={0} onClick={onTap}>
      <span className="tg-tile" style={{ "--c": KIND_COLOR[item.type] ?? KIND_COLOR.tags } as CSSProperties}>
        <Icon name={icon} size={18} />
      </span>
      <span className="set-row-text">
        <span className="set-row-title tg-title">{title}</span>
        <span className="set-row-sub">{sub}</span>
      </span>
      <button
        type="button"
        className={fav ? "tg-btn is-fav" : "tg-btn"}
        aria-pressed={fav}
        aria-label={t("tags.favs")}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav();
        }}
      >
        <Icon name="heart" size={18} solid={fav} />
      </button>
      {onRemove && (
        <button
          type="button"
          className="tg-btn"
          aria-label={t("collections.list.delete")}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="x" size={18} />
        </button>
      )}
    </div>
  );
}

/** «Выбрано»: включённые и исключённые чипами. Тап — Вкл/Искл, крестик — убрать. */
function SelectedGroup({ filters, label, onSave }: { filters: TagFilterItem[]; label: Label; onSave: () => void }) {
  const { t } = useI18n();
  const chips = (mode: TagMode) =>
    filters
      .filter((f) => f.mode === mode)
      .map((f) => (
        <span key={`${f.type}:${f.name}`} className={`tg-chip is-${mode}`}>
          <button type="button" className="tg-chip-main" onClick={() => setGlobal(f, mode === "include" ? "exclude" : "include")}>
            <Icon name={mode === "include" ? "check" : "minus"} size={14} />
            {label(toSingular(f.type), f.name)}
          </button>
          <button type="button" className="tg-chip-x" aria-label={t("collections.list.delete")} onClick={() => setGlobal(f, undefined)}>
            <Icon name="x" size={14} />
          </button>
        </span>
      ));
  return (
    <section className="set-group tg-selected">
      <div className="tg-selected-head">
        <span className="set-group-title">{t("tagsPage.selected")}</span>
        <span className="tg-selected-count">{t("tagsPage.counts", { inc: count(filters, "include"), exc: count(filters, "exclude") })}</span>
      </div>
      <div className="tg-chips">
        {chips("include")}
        {chips("exclude")}
      </div>
      <div className="tg-selected-actions">
        <button type="button" className="ax-btn ax-btn-ghost" onClick={onSave}>
          <Icon name="bookmark" size={16} />
          {t("tagsPage.toCollection")}
        </button>
        <button type="button" className="ax-btn ax-btn-ghost" onClick={() => setTagFilters([])}>
          <Icon name="refresh-ccw" size={16} />
          {t("common.reset")}
        </button>
      </div>
    </section>
  );
}

function CollectionRow({ c, active, onApply, onEdit, onDelete }: { c: TagCollection; active: boolean; onApply: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <div className={active ? "set-row tg-row is-include" : "set-row tg-row"} role="button" tabIndex={0} onClick={onApply}>
      <span className="tg-tile" style={{ "--c": "#3b82f6" } as CSSProperties}>
        <Icon name={active ? "check" : "bookmark"} size={18} />
      </span>
      <span className="set-row-text">
        <span className="set-row-title tg-title">{c.name || t("collections.untitled")}</span>
        <span className="set-row-sub">{t("tagsPage.counts", { inc: count(c.items, "include"), exc: count(c.items, "exclude") })}</span>
      </span>
      <button
        type="button"
        className="tg-btn"
        aria-label={t("collections.list.edit")}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <Icon name="edit-2" size={18} />
      </button>
      <button
        type="button"
        className="tg-btn"
        aria-label={t("collections.list.delete")}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="trash-2" size={18} />
      </button>
    </div>
  );
}

function CollectionEditor({
  draft,
  setDraft,
  isFav,
  toggleFav,
  label,
  onCancel,
  onSave,
  onFromFilters,
}: {
  draft: Draft;
  setDraft: (fn: (d: Draft | null) => Draft | null) => void;
  label: Label;
  onCancel: () => void;
  onSave: () => void;
  onFromFilters: () => void;
} & FavFns) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"all" | TagMode>("all");
  const shown = draft.items.filter((it) => mode === "all" || it.mode === mode).sort((a, b) => a.name.localeCompare(b.name));
  const update = (fn: (items: CollectionItem[]) => CollectionItem[]) => setDraft((d) => (d ? { ...d, items: fn(d.items) } : d));

  return (
    <NhModal visible onClose={onCancel} sizing="fixed" title={t(draft.id ? "collections.editTitle" : "collections.newTitle")}>
      <div className="tg-editor">
        <label className="cm-search tg-name">
          <Icon name="bookmark" size={18} />
          <input
            value={draft.name}
            placeholder={t("collections.namePlaceholder")}
            onChange={(e) => {
              const name = e.target.value;
              setDraft((d) => (d ? { ...d, name } : d));
            }}
          />
        </label>
        <div className="cm-seg tg-seg" role="radiogroup">
          {(["all", "include", "exclude"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "is-active" : ""} onClick={() => setMode(m)}>
              {t(`collections.filter.${m}`)}
              {m !== "all" && <span className="cm-chip-num"> {count(draft.items, m)}</span>}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="cm-empty is-small">{t("tagsPage.emptyCollection")}</p>
        ) : (
          <ListGroup>
            {shown.map((it) => {
              const item = tagStub(it.type, it.name);
              return (
                <TagRow
                  key={`${it.type}:${it.name}`}
                  item={item}
                  title={label(toSingular(it.type), it.name)}
                  mode={it.mode}
                  fav={isFav(it)}
                  onTap={() => update((items) => items.map((x) => (sameTag(x, it) ? { ...x, mode: x.mode === "include" ? "exclude" : "include" } : x)))}
                  onToggleFav={() => toggleFav(it)}
                  onRemove={() => update((items) => items.filter((x) => !sameTag(x, it)))}
                />
              );
            })}
          </ListGroup>
        )}
        <ListHint>{t("collections.hint")}</ListHint>
        <div className="tg-editor-actions">
          <button type="button" className="ax-btn ax-btn-ghost" onClick={onFromFilters}>
            <Icon name="download" size={16} />
            {t("collections.fromSelected")}
          </button>
          <button type="button" className="ax-btn ax-btn-ghost" onClick={() => update(() => [])}>
            <Icon name="trash-2" size={16} />
            {t("common.reset")}
          </button>
          <button type="button" className="ax-btn ax-btn-primary" onClick={onSave}>
            <Icon name="check" size={16} />
            {t("common.save")}
          </button>
        </div>
      </div>
    </NhModal>
  );
}
