/**
 * Строка вкладок браузера MoeLibre (верхняя строка заголовка окна ПК), как в Chrome:
 *  - вкладка выбирается нажатием (сразу, на нажатии кнопки мыши), средняя кнопка закрывает;
 *  - вкладки перетаскиваются мышью: соседние расступаются, пока тянешь; закреплённые — только среди закреплённых;
 *  - правая кнопка — меню: новая справа, перезагрузить, дублировать, закрепить, закрыть / другие / справа,
 *    вернуть закрытую; по пустому месту строки — новая вкладка и вернуть закрытую;
 *  - двойной щелчок по пустому месту — новая вкладка;
 *  - закреплённая вкладка — узкая, только значок ресурса, стоит слева;
 *  - «+» — выбор ресурса для новой вкладки.
 */
import { useSavedNhProfiles } from "../lib/nhAccounts";
import { addNhAccountInNewTab, NewTabAccountList, NhAvatar, openTabWithAccount } from "../shell/TabAccount";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nContext";
import { cachedCard } from "../lib/bookCards";
import { Icon, type IconName } from "../ui";
import { RESOURCES, resourceById, type ResourceDef } from "./resources";
import {
  activateTab,
  canReopenTab,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  duplicateTab,
  moveTab,
  openTab,
  reloadTab,
  reopenClosedTab,
  splitPath,
  togglePinTab,
  useActiveTabId,
  useTabs,
  type BrowserTab,
} from "./tabs";

type T = ReturnType<typeof useI18n>["t"];

/** Значок ресурса: буквы на плашке его цвета. */
export function ResourceMark({ res }: { res: ResourceDef }) {
  return (
    <span className="dk-resmark" style={{ background: res.color }} aria-hidden>
      {res.mark}
    </span>
  );
}

const PAGE_TITLES: Record<string, string> = {
  "/search": "menu.search",
  "/downloaded": "menu.downloaded",
  "/favorites": "menu.favorites",
  "/favorites-online": "menu.favoritesOnline",
  "/history": "menu.history",
  "/recommendations": "menu.recommendations",
  "/community": "nav.community",
  "/characters": "menu.characters",
  "/image-search": "search.imageSearchResultsTitle",
};

/** Подпись вкладки по её адресу: книга — название (или #id), поиск — запрос, разделы — их название. */
export function tabTitle(path: string, res: ResourceDef, t: T): string {
  const { pathname, search } = splitPath(path);
  const query = new URLSearchParams(search).get("query")?.trim();
  const book = pathname.match(/^\/(?:book|read)\/(\d+)/);
  if (book) return cachedCard(Number(book[1]))?.title || `#${book[1]}`;
  if (query) return t("desk.searchResults", { q: query });
  return PAGE_TITLES[pathname] ? t(PAGE_TITLES[pathname]) : res.name;
}

/** Сдвиг мыши, после которого нажатие считается перетаскиванием. */
const DRAG_START_PX = 5;

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  /** Где внутри вкладки за неё взялись. */
  grab: number;
  lastX: number;
  moved: boolean;
}

interface MenuState {
  x: number;
  y: number;
  /** Вкладка, по которой нажали; null — пустое место строки. */
  tab: BrowserTab | null;
}

export function BrowserTabStrip() {
  const profiles = useSavedNhProfiles();
  const { t } = useI18n();
  const tabs = useTabs();
  const active = useActiveTabId();
  const strip = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const plus = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Перетаскиваемая вкладка едет за мышью: её место в строке уже поменялось, сдвиг считается от нового места
  const follow = () => {
    const d = drag.current;
    const el = d && els.current.get(d.id);
    const box = strip.current?.getBoundingClientRect();
    if (!d || !el || !box || !strip.current) return;
    const left = Math.min(Math.max(d.lastX - d.grab - box.left, 0), strip.current.clientWidth - el.offsetWidth);
    el.style.transform = `translateX(${left - el.offsetLeft}px)`;
  };
  useLayoutEffect(follow, [tabs]);

  // Соседи расступаются плавно: вкладка, сменившая место, стартует со старого и доезжает до нового (FLIP)
  const lefts = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const prev = lefts.current;
    const next = new Map<string, number>();
    for (const [id, el] of els.current) {
      next.set(id, el.offsetLeft);
      const was = prev.get(id);
      if (was === undefined || was === el.offsetLeft || id === drag.current?.id) continue;
      el.style.transition = "none";
      el.style.transform = `translateX(${was - el.offsetLeft}px)`;
      void el.offsetWidth;
      el.style.transition = "";
      el.style.transform = "";
    }
    lefts.current = next;
  }, [tabs]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, tab: BrowserTab) => {
    if (e.button !== 0) return;
    activateTab(tab.id);
    const el = e.currentTarget;
    drag.current = { id: tab.id, pointerId: e.pointerId, startX: e.clientX, grab: e.clientX - el.getBoundingClientRect().left, lastX: e.clientX, moved: false };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.lastX = e.clientX;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < DRAG_START_PX) return;
      d.moved = true;
      setDragging(d.id);
    }
    const el = els.current.get(d.id);
    const box = strip.current?.getBoundingClientRect();
    if (!el || !box) return;
    // Новое место — сколько других вкладок (той же группы) левее середины перетаскиваемой
    const me = tabs.find((x) => x.id === d.id);
    const center = e.clientX - d.grab + el.offsetWidth / 2 - box.left;
    let to = 0;
    for (const tab of tabs) {
      if (tab.id === d.id) continue;
      const other = els.current.get(tab.id);
      if (other && other.offsetLeft + other.offsetWidth / 2 < center) to++;
    }
    const pinnedCount = tabs.filter((x) => x.pinned && x.id !== d.id).length;
    to = me?.pinned ? Math.min(to, pinnedCount) : Math.max(to, pinnedCount);
    moveTab(d.id, to);
    follow();
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const el = els.current.get(d.id);
    if (el) el.style.transform = "";
    setDragging(null);
  };

  const openMenu = (e: ReactMouseEvent, tab: BrowserTab | null) => {
    e.preventDefault();
    e.stopPropagation();
    setPicker(false);
    setMenu({ x: e.clientX, y: e.clientY, tab });
  };

  return (
    <div
      ref={strip}
      className={dragging ? "dk-btabs is-dragging" : "dk-btabs"}
      role="tablist"
      onDoubleClick={(e) => e.target === e.currentTarget && openTab()}
      onContextMenu={(e) => openMenu(e, null)}
    >
      {tabs.map((tab) => {
        const res = resourceById(tab.resource);
        const title = tabTitle(tab.path, res, t);
        const cls = ["dk-btab", tab.id === active && "is-active", tab.pinned && "is-pinned", tab.id === dragging && "is-drag"].filter(Boolean).join(" ");
        return (
          <div
            key={tab.id}
            ref={(el) => {
              if (el) els.current.set(tab.id, el);
              else els.current.delete(tab.id);
            }}
            role="tab"
            tabIndex={0}
            aria-selected={tab.id === active}
            className={cls}
            title={title}
            onPointerDown={(e) => onPointerDown(e, tab)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && activateTab(tab.id)}
            onMouseDown={(e) => {
              // Средняя кнопка — закрыть (и без автопрокрутки браузера)
              if (e.button !== 1) return;
              e.preventDefault();
              closeTab(tab.id);
            }}
            onContextMenu={(e) => openMenu(e, tab)}
          >
            <span className="dk-btab-mark">
              <ResourceMark res={res} />
              {/* Аккаунт вкладки — маленьким аватаром на значке ресурса */}
              {tab.account != null && (
                <NhAvatar className="dk-btab-acc" src={profiles[String(tab.account)]?.avatar_url} name={profiles[String(tab.account)]?.username} size={14} />
              )}
            </span>
            {!tab.pinned && <span className="dk-btab-title">{title}</span>}
            {!tab.pinned && (
              <button
                type="button"
                className="dk-btab-close"
                aria-label={t("desk.closeTab")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button
        ref={plus}
        type="button"
        className={picker ? "dk-btab-new is-open" : "dk-btab-new"}
        aria-label={t("desk.newTab")}
        title={`${t("desk.newTab")} (Ctrl+T)`}
        onClick={() => setPicker((v) => !v)}
        onContextMenu={(e) => openMenu(e, null)}
      >
        <Icon name="plus" size={16} />
      </button>
      {picker && <ResourcePicker anchor={plus.current} onClose={() => setPicker(false)} />}
      {menu && <TabContextMenu state={menu} tabs={tabs} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Закрыть панель при нажатии мимо неё, Esc, смене размера окна. */
export function useDismiss(panel: RefObject<HTMLElement | null>, onClose: () => void, anchor?: HTMLElement | null) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [panel, onClose, anchor]);
}

interface MenuItem {
  key: string;
  label: string;
  icon: IconName;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/** Меню вкладки (правая кнопка) — у курсора, не выходя за край окна. */
function TabContextMenu({ state, tabs, onClose }: { state: MenuState; tabs: BrowserTab[]; onClose: () => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useDismiss(panel, onClose);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    setPos({
      left: Math.min(state.x, window.innerWidth - el.offsetWidth - 8),
      top: Math.min(state.y, window.innerHeight - el.offsetHeight - 8),
    });
  }, [state.x, state.y]);

  const tab = state.tab;
  const at = tab ? tabs.findIndex((x) => x.id === tab.id) : -1;
  const groups: MenuItem[][] = tab
    ? [
        [
          { key: "new", label: t("desk.ctx.newRight"), icon: "plus", run: () => openTab(tab.resource, "/", tab.id) },
          { key: "reload", label: t("desk.ctx.reload"), icon: "refresh-cw", hint: "Ctrl+R", run: () => reloadTab(tab.id) },
          { key: "dup", label: t("desk.ctx.duplicate"), icon: "copy", run: () => duplicateTab(tab.id) },
          { key: "pin", label: t(tab.pinned ? "desk.ctx.unpin" : "desk.ctx.pin"), icon: "bookmark", run: () => togglePinTab(tab.id) },
        ],
        [
          { key: "close", label: t("desk.ctx.close"), icon: "x", hint: "Ctrl+W", run: () => closeTab(tab.id) },
          { key: "others", label: t("desk.ctx.closeOthers"), icon: "minus-circle", disabled: !tabs.some((x) => x.id !== tab.id && !x.pinned), run: () => closeOtherTabs(tab.id) },
          { key: "right", label: t("desk.ctx.closeRight"), icon: "arrow-right", disabled: !tabs.slice(at + 1).some((x) => !x.pinned), run: () => closeTabsToRight(tab.id) },
        ],
        [{ key: "reopen", label: t("desk.ctx.reopen"), icon: "rotate-ccw", hint: "Ctrl+Shift+T", disabled: !canReopenTab(), run: reopenClosedTab }],
      ]
    : [
        [
          { key: "new", label: t("desk.ctx.newTab"), icon: "plus", hint: "Ctrl+T", run: () => openTab() },
          { key: "reopen", label: t("desk.ctx.reopen"), icon: "rotate-ccw", hint: "Ctrl+Shift+T", disabled: !canReopenTab(), run: reopenClosedTab },
        ],
      ];

  return createPortal(
    <div ref={panel} className="dk-ctx" role="menu" style={pos ? { left: pos.left, top: pos.top } : { left: state.x, top: state.y, visibility: "hidden" }} onContextMenu={(e) => e.preventDefault()}>
      {groups.map((items, g) => (
        <div key={g} className="dk-ctx-group">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="dk-ctx-item"
              disabled={item.disabled}
              onClick={() => {
                item.run();
                onClose();
              }}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Выбор ресурса для новой вкладки — панель под «+», в виде меню вкладок кита. */
function ResourcePicker({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Шаг 2 — аккаунт для новой вкладки выбранного ресурса
  const [resource, setResource] = useState<string | null>(null);
  useDismiss(panel, onClose, anchor);

  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    const a = anchor.getBoundingClientRect();
    const w = panel.current.offsetWidth;
    setPos({ left: Math.min(Math.max(8, a.left), window.innerWidth - w - 8), top: a.bottom + 6 });
  }, [anchor, resource]);

  return createPortal(
    <div ref={panel} className="ax-tabmenu dk-respicker" role="menu" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
      {resource ? (
        <>
          <button type="button" className="ax-tabmenu-title dk-respicker-back" onClick={() => setResource(null)}>
            <Icon name="chevron-left" size={14} />
            {t("tabs.pickAccount")}
          </button>
          <NewTabAccountList
            onPick={(acc) => {
              if (acc === "add") addNhAccountInNewTab(resource);
              else openTabWithAccount(acc, resource);
              onClose();
            }}
          />
        </>
      ) : (
        <>
          <div className="ax-tabmenu-title">{t("desk.pickResource")}</div>
          {RESOURCES.map((res) => (
            <button
              key={res.id}
              type="button"
              role="menuitem"
              className="ax-tabmenu-item"
              disabled={!res.available}
              onClick={() => setResource(res.id)}
            >
              <ResourceMark res={res} />
              <span className="ax-tabmenu-text">
                <span className="ax-tabmenu-label">{res.name}</span>
                <span className="ax-tabmenu-desc">{res.host}</span>
              </span>
              {!res.available && <span className="dk-soon">{t("desk.soon")}</span>}
              {res.available && <Icon name="chevron-right" size={16} />}
            </button>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}
