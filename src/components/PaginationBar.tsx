/**
 * Панель страниц — перенос `components/PaginationBar.tsx`.
 * Внизу: ‹ (долгое нажатие −10), «N / M» (тап — шторка перехода), › (долгое нажатие +10).
 * Шторка: «Перейти к странице», поле, слайдер, −5 −1 … +1 +5, «Отмена» / «ОК».
 */
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nContext";
import { useBackHandler } from "../shell/androidBack";
import { Icon, useLongPress } from "../ui";

export function PaginationBar({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const { t } = useI18n();
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(false);
  const [value, setValue] = useState(currentPage);

  const commit = (next: number) => {
    const page = Math.max(1, Math.min(totalPages, Math.round(next)));
    if (page !== currentPage) onChange(page);
  };
  const prevLong = useLongPress(() => currentPage > 1 && commit(currentPage - 10));
  const nextLong = useLongPress(() => currentPage < totalPages && commit(currentPage + 10));

  const open = () => {
    setValue(currentPage);
    setSheet(true);
  };
  const close = () => {
    setShown(false);
    window.setTimeout(() => setSheet(false), 250);
  };

  useEffect(() => {
    if (!sheet) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(id);
  }, [sheet]);
  useBackHandler(sheet, close);

  if (totalPages <= 1) return null;

  const jump = (d: number) => setValue((v) => Math.max(1, Math.min(totalPages, v + d)));

  return (
    <>
      <div className="pagination-bar">
        <button
          type="button"
          className="pagination-btn"
          disabled={currentPage === 1}
          onPointerDown={prevLong.start}
          onPointerUp={prevLong.cancel}
          onPointerLeave={prevLong.cancel}
          onClick={() => !prevLong.fired() && commit(currentPage - 1)}
        >
          <Icon name="chevron-left" size={24} />
        </button>
        <button type="button" className="pagination-center" onClick={open}>
          <span className="pagination-pill">
            {currentPage} / {totalPages}
          </span>
        </button>
        <button
          type="button"
          className="pagination-btn"
          disabled={currentPage === totalPages}
          onPointerDown={nextLong.start}
          onPointerUp={nextLong.cancel}
          onPointerLeave={nextLong.cancel}
          onClick={() => !nextLong.fired() && commit(currentPage + 1)}
        >
          <Icon name="chevron-right" size={24} />
        </button>
      </div>

      {sheet &&
        createPortal(
          <div className={shown ? "page-sheet-root is-shown" : "page-sheet-root"}>
            <div className="page-sheet-backdrop" onClick={close} />
            <div className="page-sheet" role="dialog">
              <div className="page-sheet-handle" />
              <div className="page-sheet-header">
                <button type="button" className="page-sheet-round" onClick={() => setValue(1)} aria-label="1">
                  <Icon name="chevron-left" size={22} />
                  <Icon name="chevron-left" size={22} className="page-sheet-double" />
                </button>
                <span className="page-sheet-title">{t("reader.pagination.goToPage")}</span>
                <button type="button" className="page-sheet-round" onClick={() => setValue(totalPages)} aria-label={String(totalPages)}>
                  <Icon name="chevron-right" size={22} />
                  <Icon name="chevron-right" size={22} className="page-sheet-double" />
                </button>
              </div>
              <div className="page-sheet-value">
                <input
                  inputMode="numeric"
                  enterKeyHint="done"
                  value={String(value)}
                  onChange={(e) => {
                    const n = parseInt(e.target.value.replace(/[^\d]/g, ""), 10);
                    setValue(Number.isFinite(n) ? Math.max(1, Math.min(totalPages, n)) : 1);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      close();
                      commit(value);
                    }
                  }}
                />
                <span>/ {totalPages}</span>
              </div>
              <input
                className="page-sheet-slider"
                type="range"
                min={1}
                max={totalPages}
                step={1}
                value={value}
                style={{ "--pct": `${totalPages > 1 ? ((value - 1) / (totalPages - 1)) * 100 : 0}%` } as CSSProperties}
                onChange={(e) => setValue(Number(e.target.value))}
              />
              <div className="page-sheet-jumps">
                <button type="button" onClick={() => jump(-5)}>−5</button>
                <button type="button" onClick={() => jump(-1)}>−1</button>
                <span />
                <button type="button" onClick={() => jump(1)}>+1</button>
                <button type="button" onClick={() => jump(5)}>+5</button>
              </div>
              <div className="page-sheet-actions">
                <button type="button" className="page-sheet-cancel" onClick={close}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="page-sheet-ok"
                  onClick={() => {
                    close();
                    commit(value);
                  }}
                >
                  {t("common.ok")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
