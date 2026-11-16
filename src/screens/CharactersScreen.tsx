/**
 * Персонажи — перенос `app/characters.tsx` и `EditCharacterCardModal`: общий каталог карточек с сервера nappi.
 * Папки по пародиям или общий список по алфавиту, поиск по имени, фильтр по автору. Нажатие на карточку —
 * открыть её книгу или искать по персонажу. В режиме правки автор меняет имя, пародию и рамку своей карточки или удаляет её.
 *
 * Создание карточки со страницы книги и их показ на странице книги — отдельная часть, см. MIGRATION_PLAN.md.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteCharacterCard, getCharacterCatalog, updateCharacterCard, type CardRect, type CharacterCatalogItem } from "../api/characterCards";
import { pageSources } from "../api/media";
import { CharacterCropModal } from "../components/CharacterCropModal";
import { SmartImage } from "../components/SmartImage";
import { useI18n } from "../i18n/I18nContext";
import { useMe } from "../lib/session";
import { Button, FilterDropdown, Icon, LoadingSpinner, NhModal, NoResultsPanel } from "../ui";

const normalize = (s: string) => s.normalize("NFKC").toLowerCase().trim();
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
const usable = (item: CharacterCatalogItem) => !!item.imageUrl && !!item.rect;

interface Group {
  parody: string;
  items: CharacterCatalogItem[];
}

function buildGroups(items: CharacterCatalogItem[]): Group[] {
  const map = new Map<string, CharacterCatalogItem[]>();
  for (const item of items) {
    const key = item.parodyName ?? "";
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map]
    .map(([parody, list]) => ({
      parody,
      // Сначала карточки с картинкой
      items: [...list].sort((a, b) => Number(usable(b)) - Number(usable(a)) || byName(a.characterName, b.characterName)),
    }))
    .sort((a, b) => byName(a.parody, b.parody));
}

/** Часть страницы по рамке: страница растягивается так, чтобы рамка заняла весь контейнер. */
export const CroppedImage = memo(function CroppedImage({ url, rect }: { url: string | null; rect: CardRect | null }) {
  if (!url) return <div className="ch-image-empty" />;
  const style =
    rect && rect.width > 0 && rect.height > 0
      ? {
          width: `${100 / rect.width}%`,
          height: `${100 / rect.height}%`,
          left: `${(-rect.x / rect.width) * 100}%`,
          top: `${(-rect.y / rect.height) * 100}%`,
        }
      : { inset: 0 };
  return (
    <div className="ch-image-crop" style={style}>
      <SmartImage sources={pageSources(url)} fit="fill" showLoader={false} />
    </div>
  );
});

export function CharactersScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const me = useMe();
  const [catalog, setCatalog] = useState<CharacterCatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [needle, setNeedle] = useState("");
  const [author, setAuthor] = useState<number | null>(null);
  const [view, setView] = useState<"collections" | "list">("collections");
  const [collection, setCollection] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [action, setAction] = useState<CharacterCatalogItem | null>(null);
  const [editing, setEditing] = useState<CharacterCatalogItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCharacterCatalog()
      .then((items) => {
        if (cancelled) return;
        setCatalog(items);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("characters.error.download"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  useEffect(() => {
    const timer = window.setTimeout(() => setNeedle(normalize(search)), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const authors = useMemo(() => {
    const map = new Map<number, { label: string; count: number }>();
    for (const item of catalog ?? []) {
      if (!item.userId) continue;
      const row = map.get(item.userId);
      if (row) row.count++;
      else map.set(item.userId, { label: item.userName ?? `#${item.userId}`, count: 1 });
    }
    return [...map].sort((a, b) => b[1].count - a[1].count);
  }, [catalog]);

  const own = useMemo(() => (author == null ? (catalog ?? []) : (catalog ?? []).filter((x) => x.userId === author)), [catalog, author]);
  const groups = useMemo(() => buildGroups(own), [own]);
  const openGroup = collection !== null && !needle ? (groups.find((g) => g.parody === collection) ?? null) : null;

  const flat = useMemo(() => {
    if (needle) return own.filter((x) => normalize(x.characterName).includes(needle)).sort((a, b) => byName(a.characterName, b.characterName));
    if (openGroup) return openGroup.items;
    if (view === "list") return [...own].sort((a, b) => byName(a.characterName, b.characterName));
    return null;
  }, [own, needle, openGroup, view]);

  const canEdit = (item: CharacterCatalogItem) => !!me && item.userId === me.id && !!item.cardId;
  const searchByName = (name: string) => navigate(`/explore?query=${encodeURIComponent(name)}`);

  const press = (item: CharacterCatalogItem) => {
    if (editMode) {
      if (canEdit(item)) setEditing(item);
    } else if (item.bookExternalId) setAction(item);
    else searchByName(item.characterName);
  };

  if (error && !catalog) {
    return (
      <div className="screen-fill">
        <NoResultsPanel title={t("characters.error.download")} subtitle={error} actions={[{ label: t("common.retry"), onPress: () => setReload((n) => n + 1) }]} />
      </div>
    );
  }

  const empty = flat ? flat.length === 0 : groups.length === 0;

  return (
    <div className="screen-fill">
      <div className="ch-head">
        <div className="search-input-wrap">
          <Icon name="search" size={18} className="search-input-icon" />
          <input value={search} placeholder={t("characters.searchPlaceholder")} onChange={(e) => setSearch(e.target.value)} />
          {search !== "" && (
            <button type="button" className="search-small-btn" aria-label={t("common.reset")} onClick={() => setSearch("")}>
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
        <div className="ch-controls">
          {openGroup ? (
            <button type="button" className="ch-back" onClick={() => setCollection(null)}>
              <Icon name="arrow-left" size={16} />
              {t("characters.backToCollections")}
            </button>
          ) : (
            <button
              type="button"
              className="ax-icon-btn"
              aria-label={t("characters.switchView")}
              onClick={() => setView((v) => (v === "collections" ? "list" : "collections"))}
            >
              <Icon name={view === "collections" ? "list" : "grid"} size={20} />
            </button>
          )}
          <span className="ch-spacer" />
          <FilterDropdown
            variant="chip"
            minWidth={120}
            value={author == null ? "all" : String(author)}
            onChange={(v) => setAuthor(v === "all" ? null : Number(v))}
            options={[
              { value: "all", label: `${t("characters.filter.allUsers")} (${catalog?.length ?? 0})` },
              ...authors.map(([id, a]) => ({ value: String(id), label: `${a.label} (${a.count})` })),
            ]}
          />
          {me && (
            <button
              type="button"
              className={editMode ? "ax-icon-btn ch-edit-on" : "ax-icon-btn"}
              aria-label={t("characters.editMode")}
              aria-pressed={editMode}
              onClick={() => setEditMode((m) => !m)}
            >
              <Icon name="edit-3" size={18} />
            </button>
          )}
        </div>
        {openGroup && (
          <div className="ch-subhead">
            <b>{openGroup.parody || t("characters.collection.untitled")}</b>
            <span>{t("characters.charactersCount", { count: openGroup.items.length })}</span>
          </div>
        )}
      </div>

      <div className="screen-scroll">
        {!catalog ? (
          <LoadingSpinner />
        ) : empty ? (
          <p className="search-empty">{t("characters.empty")}</p>
        ) : flat ? (
          <div className="ch-grid">
            {flat.map((item) => (
              <CharacterCard key={`${item.cardId ?? item.characterName}:${item.parodyName}`} item={item} dim={editMode && !canEdit(item)} onPress={press} />
            ))}
          </div>
        ) : (
          <div className="ch-grid">
            {groups.map((g) => (
              <button key={g.parody} type="button" className="ch-card ch-folder" onClick={() => setCollection(g.parody)}>
                <span className="ch-folder-grid">
                  {g.items.slice(0, 4).map((item) => (
                    <span key={item.cardId ?? item.characterName} className="ch-image">
                      <CroppedImage url={item.imageUrl} rect={item.rect} />
                    </span>
                  ))}
                </span>
                <span className="ch-card-name">{g.parody || t("characters.collection.untitled")}</span>
                <span className="ch-card-sub">{t("characters.charactersCount", { count: g.items.length })}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <NhModal visible={!!action} onClose={() => setAction(null)} title={t("characters.cardActions.title")}>
        <div className="ch-actions">
          <Button
            title={t("characters.cardActions.openBook")}
            onPress={() => {
              if (action?.bookExternalId) navigate(`/book/${action.bookExternalId}`);
              setAction(null);
            }}
          />
          <Button
            title={t("characters.cardActions.searchByCharacter")}
            variant="secondary"
            onPress={() => {
              if (action) searchByName(action.characterName);
              setAction(null);
            }}
          />
        </div>
      </NhModal>

      {editing && me && (
        <EditCardModal
          item={editing}
          userId={me.id}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

const CharacterCard = memo(function CharacterCard({ item, dim, onPress }: { item: CharacterCatalogItem; dim: boolean; onPress: (item: CharacterCatalogItem) => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className={dim ? "ch-card is-dim" : "ch-card"} onClick={() => onPress(item)}>
      <span className="ch-image">
        <CroppedImage url={item.imageUrl} rect={item.rect} />
      </span>
      <span className="ch-card-name">{item.characterName}</span>
      <span className="ch-card-sub">{item.parodyName || t("characters.collection.untitled")}</span>
    </button>
  );
});

function EditCardModal({ item, userId, onClose, onChanged }: { item: CharacterCatalogItem; userId: number; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(item.characterName);
  const [parody, setParody] = useState(item.parodyName ?? "");
  const [rect, setRect] = useState(item.rect);
  const [crop, setCrop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>, errorKey: string) => {
    setSaving(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(errorKey));
      setSaving(false);
    }
  };

  const save = () => {
    const characterName = name.trim();
    if (!characterName) return setError(t("characters.validation.nameRequired"));
    void run(
      () =>
        updateCharacterCard(item.cardId!, {
          characterName,
          parodyName: parody.trim() || null,
          imageUrl: item.imageUrl ?? "",
          rect: rect ?? { x: 0, y: 0, width: 1, height: 1 },
          userId,
        }),
      "characters.error.save",
    );
  };

  return (
    <>
      <NhModal visible onClose={onClose} title={t("editCard.title")} hint={t("editCard.warningText")}>
        <div className="ch-edit">
          <div className="ch-edit-preview">
            <span className="ch-image">
              <CroppedImage url={item.imageUrl} rect={rect} />
            </span>
            <Button title={t("editCard.editArea")} variant="secondary" compact onPress={() => setCrop(true)} />
          </div>
          <label className="ch-field">
            <span>{t("editCard.labelCharacter")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="ch-field">
            <span>{t("editCard.labelParody")}</span>
            <input value={parody} onChange={(e) => setParody(e.target.value)} />
          </label>
          {error && <p className="ch-error">{error}</p>}
          <div className="ch-actions is-row">
            <Button
              title={confirmDelete ? t("characters.deleteConfirm") : t("editCard.delete")}
              variant="secondary"
              compact
              disabled={saving}
              onPress={() => {
                if (!confirmDelete) setConfirmDelete(true);
                else void run(() => deleteCharacterCard(item.cardId!, userId), "characters.error.delete");
              }}
            />
            <span className="ch-spacer" />
            <Button title={t("editCard.cancel")} variant="secondary" compact onPress={onClose} />
            <Button title={t("editCard.save")} compact loading={saving} disabled={saving} onPress={save} />
          </div>
        </div>
      </NhModal>
      <CharacterCropModal
        visible={crop}
        imageUrl={item.imageUrl ?? ""}
        initial={rect}
        onCancel={() => setCrop(false)}
        onConfirm={(next) => {
          setRect(next);
          setCrop(false);
        }}
      />
    </>
  );
}
