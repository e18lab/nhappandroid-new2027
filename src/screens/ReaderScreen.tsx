/**
 * Читалка — перенос `app/read.tsx` + `components/read/*` (релиз 1.3.1).
 *
 * Постраничный режим: листание свайпом (горизонтально или вертикально), тап по краям — назад/вперёд,
 * по центру — показать/скрыть управление; на планшете в альбомной — разворот на две страницы.
 * Непрерывная лента: страницы одна под другой во всю ширину.
 * Сверху «Назад» и «Настройки», снизу (телефон) или справа (планшет) лента миниатюр,
 * подсказки зон при входе (3 с), баннер при смене режима. Настройки — `reader_last_*`, как в старом.
 * Прогресс пишется в `readHistory` при открытии и на каждой смене страницы.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { galleryToBook, type BookPage } from "../api/book";
import { getGallery } from "../api/galleries";
import { loadLocalBook } from "../lib/downloads";
import { initCdn, pageSources } from "../api/media";
import { SmartImage } from "../components/SmartImage";
import { useI18n } from "../i18n/I18nContext";
import { cachedFullBook, rememberFullBook } from "../lib/bookEnrich";
import { rememberGallery } from "../lib/bookCards";
import { getReadProgress, updateReadHistory } from "../lib/library";
import { KEYS, getItem, setItem } from "../lib/storage";
import { useBackHandler } from "../shell/androidBack";
import { Icon, LoadingSpinner, type IconName } from "../ui";

type Orientation = "vertical" | "horizontal";
type FitMode = "contain" | "cover";

const G_ORIENT = "reader_last_orient";
const G_DUAL = "reader_last_dual";
const G_FIT = "reader_last_fit";
const G_TAP = "reader_last_tap";
const G_HAND = "reader_last_hand";
const G_INSPECT = "reader_last_inspect";
const G_CONT = "reader_last_continuous";

const getBool = (key: string, def: boolean) => {
  const v = getItem(key);
  return v == null ? def : v === "1" || v.toLowerCase() === "true";
};
const saveBool = (key: string, v: boolean) => setItem(key, v ? "1" : "0");

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

const PREFETCH_AHEAD = 12;
const PREFETCH_BEHIND = 4;

/**
 * Прогрев кеша соседних страниц (как `ExpoImage.prefetch` в старом `read.tsx`): вперёд 12, назад 4.
 * В DOM держатся только ±2 кадра, остальное браузер берёт из кеша при листании.
 */
function usePrefetchPages(pages: BookPage[], abs: number) {
  const done = useRef(new Set<string>());
  useEffect(() => {
    done.current.clear();
  }, [pages]);
  useEffect(() => {
    if (!pages.length) return;
    const order: number[] = [];
    for (let i = 1; i <= PREFETCH_AHEAD; i++) order.push(abs + i);
    for (let i = 1; i <= PREFETCH_BEHIND; i++) order.push(abs - i);
    const timer = window.setTimeout(() => {
      for (const i of order) {
        const url = pages[i] && pageSources(pages[i].path)[0];
        if (!url || done.current.has(url)) continue;
        done.current.add(url);
        const img = new Image();
        img.decoding = "async";
        img.src = url;
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [pages, abs]);
}

export function ReaderScreen() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bookId = Number(id);
  const { w: W, h: H } = useViewport();
  const isTablet = Math.min(W, H) >= 600;
  const isLandscape = W > H;
  const isPhone = !isTablet;

  const [pages, setPages] = useState<BookPage[]>([]);
  const [failed, setFailed] = useState(false);
  const [uiVisible, setUI] = useState(true);
  const [orientation, setOrientation] = useState<Orientation>(
    () => (getItem(G_ORIENT) as Orientation | null) ?? (isLandscape ? "horizontal" : "vertical"),
  );
  const [dual, setDual] = useState(() => getBool(G_DUAL, true));
  const [fit, setFit] = useState<FitMode>(() => (getItem(G_FIT) as FitMode | null) ?? "contain");
  const [tapFlip, setTapFlip] = useState(() => getBool(G_TAP, true));
  const [handSwap, setHandSwap] = useState(() => getBool(G_HAND, false));
  const [inspect, setInspect] = useState(() => getBool(G_INSPECT, false));
  const [continuous, setContinuous] = useState(() => getBool(G_CONT, false));
  const [hideHints, setHideHints] = useState(() => getBool(KEYS.readerHideHints, false));
  const [hints, setHints] = useState({ left: true, center: true, right: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [banner, setBanner] = useState<{ text: string; key: number } | null>(null);
  const [abs, setAbs] = useState(0);
  const absRef = useRef(0);
  const pager = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  // ── Загрузка книги ──
  useEffect(() => {
    if (!Number.isFinite(bookId) || bookId <= 0) {
      navigate(-1);
      return;
    }
    let cancelled = false;
    initialized.current = false;
    (async () => {
      try {
        // Скачанная — с устройства, как loadBookFromLocal в старом read.tsx
        let book = await loadLocalBook(bookId);
        if (!book) await initCdn();
        if (!book) book = cachedFullBook(bookId) ?? null;
        if (!book) {
          const g = await getGallery(bookId);
          book = galleryToBook(g);
          rememberFullBook(book);
          rememberGallery(g);
        }
        if (cancelled) return;
        const fromRoute = Math.max(0, (parseInt(params.get("page") ?? "", 10) || 0) - 1);
        const fromHistory = getReadProgress(bookId)?.current ?? 0;
        const start = Math.max(0, Math.min(book.pages.length - 1, params.get("page") ? fromRoute : fromHistory));
        absRef.current = start;
        setAbs(start);
        setPages(book.pages);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // страница из адреса читается один раз при открытии
  }, [bookId]);

  const total = pages.length;
  const useDual = !continuous && dual && isLandscape && isTablet && total >= 2;

  const frames = useMemo(() => {
    if (!useDual) return pages.map((_, i) => [i]);
    const out: number[][] = [];
    for (let i = 0; i < total; i += 2) out.push(i + 1 < total ? [i, i + 1] : [i]);
    return out;
  }, [pages, total, useDual]);

  usePrefetchPages(pages, abs);

  const frameOf = useCallback((a: number) => (useDual ? Math.floor(a / 2) : a), [useDual]);
  const frameIdx = frameOf(abs);
  const isSingleFrame = (frames[frameIdx]?.length ?? 1) === 1;

  const commitAbs = useCallback(
    (next: number) => {
      if (!total) return;
      const a = Math.max(0, Math.min(total - 1, next));
      absRef.current = a;
      setAbs(a);
      updateReadHistory(bookId, a, total);
    },
    [bookId, total],
  );

  // Прогресс при открытии — как в старом
  useEffect(() => {
    if (total) updateReadHistory(bookId, absRef.current, total);
  }, [bookId, total]);

  // ── Постраничный режим: прокрутка к кадру и отслеживание свайпа ──
  const horizontal = orientation === "horizontal";
  const scrollToFrame = useCallback(
    (f: number, smooth: boolean) => {
      const el = pager.current;
      if (!el) return;
      const opts: ScrollToOptions = horizontal ? { left: f * el.clientWidth } : { top: f * el.clientHeight };
      el.scrollTo({ ...opts, behavior: smooth ? "smooth" : "auto" });
    },
    [horizontal],
  );

  useLayoutEffect(() => {
    if (!total || continuous) return;
    scrollToFrame(frameOf(absRef.current), false);
    initialized.current = true;
    // при смене режима/размера возвращаемся к текущей странице
  }, [total, continuous, horizontal, useDual, W, H]);

  const onPagerScroll = () => {
    const el = pager.current;
    if (!el || !initialized.current) return;
    const pos = horizontal ? el.scrollLeft / Math.max(1, el.clientWidth) : el.scrollTop / Math.max(1, el.clientHeight);
    const f = Math.round(pos);
    if (Math.abs(pos - f) > 0.02) return; // ждём, пока кадр встанет на место
    const group = frames[f];
    if (!group) return;
    const a = useDual ? Math.max(...group) : group[0];
    if (a !== absRef.current) commitAbs(a);
  };

  const jumpFrame = (next: number) => {
    if (next >= 0 && next < frames.length) scrollToFrame(next, true);
  };
  const goToAbs = (a: number) => {
    if (continuous) {
      list.current?.children[a]?.scrollIntoView({ block: "start" });
      commitAbs(a);
    } else {
      scrollToFrame(frameOf(a), true);
    }
  };

  // ── Непрерывная лента: текущая — самая нижняя видимая на 60% ──
  useEffect(() => {
    if (!continuous || !total) return;
    const root = list.current;
    if (!root) return;
    root.children[absRef.current]?.scrollIntoView({ block: "start" });
    const visible = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index);
          if (e.intersectionRatio >= 0.6 || (e.isIntersecting && e.intersectionRect.height >= root.clientHeight * 0.6)) visible.add(i);
          else visible.delete(i);
        }
        if (visible.size) commitAbs(Math.max(...visible));
      },
      { root, threshold: [0, 0.6, 1] },
    );
    Array.from(root.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [continuous, total, commitAbs]);

  // ── Подсказки зон: гаснут через 3 с или по первому тапу ──
  useEffect(() => {
    if (hideHints || !(hints.left || hints.center || hints.right)) return;
    const timer = window.setTimeout(() => setHints({ left: false, center: false, right: false }), 3000);
    return () => window.clearTimeout(timer);
  }, [hideHints, hints]);

  const showBanner = (text: string) => setBanner({ text, key: Date.now() });
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 1340);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const onTapZone = (clientX: number) => {
    setHints({ left: false, center: false, right: false });
    if (continuous) {
      setUI((v) => !v);
      return;
    }
    const side = clientX < W / 3 ? "left" : clientX > (2 * W) / 3 ? "right" : "center";
    if (side === "center") {
      setUI((v) => !v);
      return;
    }
    if (!tapFlip) {
      setUI(true);
      return;
    }
    let dir: "prev" | "next" = side === "left" ? "prev" : "next";
    if (handSwap) dir = dir === "prev" ? "next" : "prev";
    jumpFrame(frameIdx + (dir === "prev" ? -1 : 1));
  };

  // Клавиатура на ПК
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen || continuous) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") jumpFrame(frameIdx + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") jumpFrame(frameIdx - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleContinuous = () => {
    const nv = !continuous;
    setContinuous(nv);
    saveBool(G_CONT, nv);
    showBanner(nv ? "Continuous scroll: ON" : "Continuous scroll: OFF");
  };
  const onOff = (v: boolean) => (v ? t("reader.banner.on") : t("reader.banner.off"));

  // Как в старом: не удалось открыть книгу — назад
  useEffect(() => {
    if (failed) navigate(-1);
  }, [failed, navigate]);

  if (failed) return null;
  if (!total) return <LoadingSpinner fullScreen color="#fff" />;

  const back = () => navigate(-1);
  const phoneBottomInset = 8 + 76 + 8;

  return (
    <div className="reader">
      {continuous ? (
        <div ref={list} className="reader-list" onClick={(e) => onTapZone(e.clientX)}>
          {pages.map((p, i) => (
            <div
              key={p.page}
              data-index={i}
              className="reader-list-item"
              style={{ aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : "2 / 3" }}
            >
              <SmartImage sources={pageSources(p.path)} fit="cover" eager={Math.abs(i - abs) <= 2} />
            </div>
          ))}
        </div>
      ) : (
        <div
          ref={pager}
          className={`reader-pager ${horizontal ? "is-horizontal" : "is-vertical"}${inspect ? " is-locked" : ""}`}
          onScroll={onPagerScroll}
          onClick={(e) => !inspect && onTapZone(e.clientX)}
        >
          {frames.map((group, i) => {
            const near = Math.abs(i - frameIdx) <= 2;
            return (
              <div key={i} className="reader-frame">
                {!near ? null : inspect && group.length === 1 && i === frameIdx ? (
                  <InspectCanvas sources={pageSources(pages[group[0]].path)} />
                ) : group.length === 2 ? (
                  <div className="reader-dual">
                    {group.map((a, k) => (
                      <div key={a} className={k === 1 ? "reader-dual-half is-right" : "reader-dual-half"}>
                        <SmartImage sources={pageSources(pages[a].path)} fit={fit} eager />
                      </div>
                    ))}
                  </div>
                ) : (
                  <SmartImage sources={pageSources(pages[group[0]].path)} fit={fit} eager />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!continuous && !hideHints && (hints.left || hints.center || hints.right) && (
        <div className="reader-hints" style={{ bottom: isPhone && uiVisible ? phoneBottomInset : 0 }}>
          <div className="reader-hint is-side" style={{ left: 0, width: "30%" }}>
            {`${t("common.tapHere")} — ${handSwap ? t("common.nextPage") : t("common.back")}`}
          </div>
          <div className="reader-hint is-center" style={{ left: "30%", width: "40%" }}>
            {`${t("common.tapHere")} — ${t("reader.menuHint")}`}
          </div>
          <div className="reader-hint is-side" style={{ right: 0, width: "30%" }}>
            {`${t("common.tapHere")} — ${handSwap ? t("common.back") : t("common.nextPage")}`}
          </div>
        </div>
      )}

      {banner && (
        <div key={banner.key} className="reader-banner">
          {banner.text}
        </div>
      )}

      {uiVisible &&
        (isPhone ? (
          <div className="reader-top">
            <RowBtn icon="corner-up-left" label={t("reader.controls.back")} onPress={back} />
            {continuous ? (
              <RowBtn icon="align-justify" label={t("reader.controls.scroll")} accent onPress={toggleContinuous} />
            ) : (
              <RowBtn icon="settings" label={t("reader.controls.settings")} onPress={() => setSettingsOpen(true)} />
            )}
          </div>
        ) : (
          <div className="reader-top-left">
            <IconBtn icon="corner-up-left" onPress={back} />
            {continuous ? (
              <IconBtn icon="align-justify" accent onPress={toggleContinuous} />
            ) : (
              <>
                <IconBtn icon="chevron-left" onPress={() => jumpFrame(frameIdx - 1)} />
                <IconBtn icon="chevron-right" onPress={() => jumpFrame(frameIdx + 1)} />
                <span className="reader-divider" />
                <IconBtn icon="settings" onPress={() => setSettingsOpen(true)} />
              </>
            )}
          </div>
        ))}

      {!continuous && uiVisible && (
        <ThumbRail
          pages={pages}
          frames={frames}
          frameIdx={frameIdx}
          activeAbs={useDual ? Math.max(...(frames[frameIdx] ?? [abs])) : abs}
          useDual={useDual}
          horizontal={isPhone}
          onPick={goToAbs}
        />
      )}

      {settingsOpen && (
        <ReaderSettings
          onClose={() => setSettingsOpen(false)}
          canDual={isLandscape && isTablet && total >= 2}
          rows={{
            orientation: {
              value: orientation,
              onPress: () => {
                const nv: Orientation = orientation === "vertical" ? "horizontal" : "vertical";
                setOrientation(nv);
                setItem(G_ORIENT, nv);
                showBanner(
                  t("reader.banner.orientation", {
                    mode: nv === "vertical" ? t("reader.banner.orientationVertical") : t("reader.banner.orientationHorizontal"),
                  }),
                );
              },
            },
            dual: {
              value: dual,
              onPress: () => {
                setDual(!dual);
                saveBool(G_DUAL, !dual);
                showBanner(t("reader.banner.dual", { state: onOff(!dual) }));
              },
            },
            fit: {
              value: fit,
              onPress: () => {
                const nv: FitMode = fit === "contain" ? "cover" : "contain";
                setFit(nv);
                setItem(G_FIT, nv);
                showBanner(t("reader.banner.fit", { mode: nv === "contain" ? t("reader.banner.fitContain") : t("reader.banner.fitCover") }));
              },
            },
            tap: {
              value: tapFlip,
              onPress: () => {
                setTapFlip(!tapFlip);
                saveBool(G_TAP, !tapFlip);
                showBanner(t("reader.banner.tap", { state: onOff(!tapFlip) }));
              },
            },
            hand: {
              value: handSwap,
              onPress: () => {
                setHandSwap(!handSwap);
                saveBool(G_HAND, !handSwap);
                showBanner(t("reader.banner.hand", { state: onOff(!handSwap) }));
              },
            },
            inspect: {
              value: inspect,
              disabled: !isSingleFrame,
              onPress: () => {
                setInspect(!inspect);
                saveBool(G_INSPECT, !inspect);
                showBanner(t("reader.banner.inspect", { state: onOff(!inspect) }));
              },
            },
            continuous: { value: continuous, onPress: toggleContinuous },
            hideHints: {
              value: hideHints,
              onPress: () => {
                setHideHints(!hideHints);
                saveBool(KEYS.readerHideHints, !hideHints);
              },
            },
          }}
        />
      )}
    </div>
  );
}

function RowBtn({ icon, label, onPress, accent = false }: { icon: IconName; label: string; onPress: () => void; accent?: boolean }) {
  return (
    <button type="button" className={accent ? "reader-row-btn is-accent" : "reader-row-btn"} onClick={onPress}>
      <Icon name={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

function IconBtn({ icon, onPress, accent = false }: { icon: IconName; onPress: () => void; accent?: boolean }) {
  return (
    <button type="button" className={accent ? "reader-icon-btn is-accent" : "reader-icon-btn"} onClick={onPress}>
      <Icon name={icon} size={18} />
    </button>
  );
}

/** Лента миниатюр (ThumbRail): 52×64, радиус 12, выбранная — яркая с акцентной рамкой, остальные 35%. */
function ThumbRail({
  pages,
  frames,
  frameIdx,
  activeAbs,
  useDual,
  horizontal,
  onPick,
}: {
  pages: BookPage[];
  frames: number[][];
  frameIdx: number;
  activeAbs: number;
  useDual: boolean;
  horizontal: boolean;
  onPick: (abs: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const STEP_H = 52 + 5;
  const STEP_V = 64 + 5;

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    if (horizontal) el.scrollTo({ left: activeAbs * STEP_H - el.clientWidth / 2 + 26, behavior: "smooth" });
    else el.scrollTo({ top: activeAbs * STEP_V - el.clientHeight / 1.7 + 32, behavior: "smooth" });
  }, [activeAbs, horizontal]);

  return (
    <div className={horizontal ? "thumb-rail is-horizontal" : "thumb-rail is-vertical"} onClick={(e) => e.stopPropagation()}>
      <div ref={rail} className="thumb-rail-scroll">
        {pages.map((p, i) => {
          const selected = useDual ? frames[frameIdx]?.includes(i) : i === activeAbs;
          return (
            <button key={p.page} type="button" className={selected ? "thumb-rail-item is-selected" : "thumb-rail-item"} onClick={() => onPick(i)}>
              <SmartImage sources={pageSources(p.path)} showLoader={false} />
            </button>
          );
        })}
      </div>
      <span className="thumb-rail-fade is-start" />
      <span className="thumb-rail-fade is-end" />
      {!horizontal && (
        <span className="thumb-rail-counter">
          {Math.min(activeAbs + 1, pages.length)} / {pages.length}
        </span>
      )}
    </div>
  );
}

interface Row<T> {
  value: T;
  onPress: () => void;
  disabled?: boolean;
}

/** Окно настроек читалки (SettingsModal): строки с переключателями и значениями. */
function ReaderSettings({
  onClose,
  canDual,
  rows,
}: {
  onClose: () => void;
  canDual: boolean;
  rows: {
    orientation: Row<Orientation>;
    dual: Row<boolean>;
    fit: Row<FitMode>;
    tap: Row<boolean>;
    hand: Row<boolean>;
    inspect: Row<boolean>;
    continuous: Row<boolean>;
    hideHints: Row<boolean>;
  };
}) {
  const { t } = useI18n();
  useBackHandler(true, onClose);

  const toggle = (on: boolean) => (
    <span className={on ? "reader-switch is-on" : "reader-switch"}>
      <span />
    </span>
  );
  const row = (icon: IconName, label: string, r: Row<unknown>, right: ReactNode) => (
    <button type="button" className="reader-settings-row" disabled={r.disabled} onClick={r.onPress}>
      <span className="reader-settings-left">
        <Icon name={icon} size={20} />
        <span>{label}</span>
      </span>
      {right}
    </button>
  );

  return createPortal(
    <div className="reader-settings-overlay" onClick={onClose}>
      <div className="reader-settings" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="reader-settings-header">
          <span>{t("reader.controls.settings")}</span>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="reader-settings-body">
          {row(
            rows.orientation.value === "vertical" ? "arrow-down" : "arrow-right",
            t("reader.controls.orientation"),
            rows.orientation,
            <span className="reader-settings-value">
              {rows.orientation.value === "vertical" ? t("reader.controls.vertical") : t("reader.controls.horizontal")}
            </span>,
          )}
          {canDual && row("layout", t("reader.controls.dual"), rows.dual, toggle(rows.dual.value))}
          {row(
            rows.fit.value === "contain" ? "maximize" : "minimize",
            t("reader.controls.fit"),
            rows.fit,
            <span className="reader-settings-value">
              {rows.fit.value === "contain" ? t("reader.controls.fitContain") : t("reader.controls.fitCover")}
            </span>,
          )}
          {row("loader", t("reader.controls.tap"), rows.tap, toggle(rows.tap.value))}
          {row("repeat", t("reader.controls.handSwap"), rows.hand, toggle(rows.hand.value))}
          {row("search", t("reader.controls.inspect"), rows.inspect, toggle(rows.inspect.value && !rows.inspect.disabled))}
          {row("align-justify", t("reader.controls.continuous"), rows.continuous, toggle(rows.continuous.value))}
          {row("eye-off", t("settings.reader.hideHints"), rows.hideHints, toggle(rows.hideHints.value))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Режим «Просмотр» (InspectCanvas): щипок — масштаб (не меньше 1), сдвиг, поворот двумя пальцами. */
function InspectCanvas({ sources }: { sources: string[] }) {
  const [tf, setTf] = useState({ x: 0, y: 0, s: 1, r: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; angle: number; cx: number; cy: number } | null>(null);

  const measure = () => {
    const [a, b] = [...pointers.current.values()];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  };

  const style: CSSProperties = { transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s}) rotate(${tf.r}rad)` };

  return (
    <div
      className="reader-inspect"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        gesture.current = pointers.current.size === 2 ? measure() : null;
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 1) {
          setTf((v) => ({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
        } else if (pointers.current.size === 2 && gesture.current) {
          const now = measure();
          const g = gesture.current;
          setTf((v) => ({
            x: v.x + now.cx - g.cx,
            y: v.y + now.cy - g.cy,
            s: Math.max(1, v.s * (now.dist / Math.max(1, g.dist))),
            r: v.r + now.angle - g.angle,
          }));
          gesture.current = now;
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        gesture.current = pointers.current.size === 2 ? measure() : null;
      }}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      onWheel={(e) => setTf((v) => ({ ...v, s: Math.max(1, v.s * (e.deltaY < 0 ? 1.1 : 0.9)) }))}
      onDoubleClick={() => setTf({ x: 0, y: 0, s: 1, r: 0 })}
    >
      <div className="reader-inspect-img" style={style}>
        <SmartImage sources={sources} fit="contain" eager />
      </div>
    </div>
  );
}
