/**
 * Выбор диапазона дат для фильтра — перенос `components/CalendarRangePicker.tsx`.
 * Первое нажатие — «От», второе — «До» (если раньше «От», даты меняются местами).
 * Месяц и год выбираются списком поверх (`openSubmenu` из FilterDropdown).
 * Даты не раньше 28.06.2014 (первая книга на сайте) и не позже сегодняшнего дня.
 */
import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { Icon } from "../ui";
import type { CustomContentProps } from "../ui/FilterDropdown";

const MIN_DATE = new Date(2014, 5, 28);
const MIN_YEAR = 2014;
const MIN_MONTH = 5; // июнь

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseISODate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const pad = (n: number) => String(n).padStart(2, "0");
export const formatDMY = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Недели месяца с понедельника, включая хвосты соседних месяцев. */
function monthWeeks(view: Date): Date[][] {
  const first = startOfMonth(view);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const rows: Date[][] = [];
  for (const d = new Date(start); d <= end; ) {
    const row: Date[] = [];
    for (let i = 0; i < 7; i++) {
      row.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    rows.push(row);
  }
  return rows;
}

type Props = Pick<CustomContentProps, "onClose" | "openSubmenu"> & {
  onApply: (from: Date, to: Date) => void;
  onReset?: () => void;
  initialFrom?: string | null;
  initialTo?: string | null;
};

export function CalendarRangePicker({ onApply, onClose, onReset, openSubmenu, initialFrom, initialTo }: Props) {
  const { t, resolved } = useI18n();
  const now = today();
  const [fromDate, setFromDate] = useState<Date | null>(() => parseISODate(initialFrom));
  const [toDate, setToDate] = useState<Date | null>(() => parseISODate(initialTo));
  // Открываем на месяце «До», если диапазон уже был, иначе на текущем
  const [view, setView] = useState(() => startOfMonth(parseISODate(initialTo) ?? parseISODate(initialFrom) ?? now));
  const [error, setError] = useState("");

  const monthNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(resolved, { month: "long" });
    return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2020, i, 1)));
  }, [resolved]);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(resolved, { weekday: "short" });
    // 6 января 2020 — понедельник
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2020, 0, 6 + i)));
  }, [resolved]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const canPrev = year > MIN_YEAR || (year === MIN_YEAR && month > MIN_MONTH);
  const canNext = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth());
  const weeks = useMemo(() => monthWeeks(view), [view]);

  const pressDay = (d: Date) => {
    if (d < MIN_DATE || d > now) return;
    setError("");
    if (!fromDate || toDate) {
      setFromDate(d);
      setToDate(null);
    } else if (d < fromDate) {
      setToDate(fromDate);
      setFromDate(d);
    } else {
      setToDate(d);
    }
  };

  const apply = () => {
    if (!fromDate || !toDate) return setError(t("explore.calendar.bothDates"));
    if (fromDate > toDate) return setError(t("explore.calendar.fromAfterTo"));
    if (fromDate < MIN_DATE) return setError(t("explore.calendar.minDate"));
    onApply(fromDate, toDate);
    onClose();
  };

  const pickMonth = async () => {
    const from = year === MIN_YEAR ? MIN_MONTH : 0;
    const to = year === now.getFullYear() ? now.getMonth() : 11;
    const items = Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: monthNames[from + i] }));
    const val = await openSubmenu(t("explore.calendar.chooseMonth"), items);
    if (val != null) setView(new Date(year, Number(val), 1));
  };

  const pickYear = async () => {
    const items = Array.from({ length: now.getFullYear() - MIN_YEAR + 1 }, (_, i) => {
      const y = now.getFullYear() - i;
      return { value: String(y), label: String(y) };
    });
    const val = await openSubmenu(t("explore.calendar.chooseYear"), items);
    if (val == null) return;
    const y = Number(val);
    // Месяц за пределами допустимого для выбранного года прижимаем к краю
    let m = month;
    if (y === MIN_YEAR) m = Math.max(m, MIN_MONTH);
    if (y === now.getFullYear()) m = Math.min(m, now.getMonth());
    setView(new Date(y, m, 1));
  };

  return (
    <div className="cal">
      <div className="cal-header">
        <button type="button" className="cal-nav" disabled={!canPrev} onClick={() => setView(new Date(year, month - 1, 1))}>
          <Icon name="chevron-left" size={24} />
        </button>
        <div className="cal-header-center">
          <button type="button" className="cal-title" onClick={() => void pickMonth()}>
            {monthNames[month]}
          </button>
          <button type="button" className="cal-title" onClick={() => void pickYear()}>
            {year}
          </button>
        </div>
        <button type="button" className="cal-nav" disabled={!canNext} onClick={() => setView(new Date(year, month + 1, 1))}>
          <Icon name="chevron-right" size={24} />
        </button>
      </div>

      <div className="cal-weekdays">
        {weekdays.map((wd) => (
          <span key={wd}>{wd}</span>
        ))}
      </div>

      <div className="cal-grid">
        {weeks.map((row) => (
          <div key={row[0].getTime()} className="cal-row">
            {row.map((d) => {
              const disabled = d < MIN_DATE || d > now;
              const edge = (fromDate && sameDay(d, fromDate)) || (toDate && sameDay(d, toDate));
              const inRange = !!fromDate && !!toDate && d >= fromDate && d <= toDate;
              const cls = [
                "cal-cell",
                d.getMonth() !== month && "is-outside",
                edge ? "is-edge" : inRange && "is-range",
                sameDay(d, now) && "is-today",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button key={d.getTime()} type="button" className={cls} disabled={disabled} onClick={() => pressDay(d)}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="cal-summary">
        <span>
          {t("explore.calendar.from")}: {fromDate ? formatDMY(fromDate) : "—"}
        </span>
        <span>
          {t("explore.calendar.to")}: {toDate ? formatDMY(toDate) : "—"}
        </span>
      </div>
      {error && <p className="cal-error">{error}</p>}
      <div className="cal-actions">
        <button
          type="button"
          className="cal-btn"
          onClick={() => {
            setFromDate(null);
            setToDate(null);
            setError("");
            onReset?.();
            onClose();
          }}
        >
          {t("common.reset")}
        </button>
        <button type="button" className="cal-btn is-primary" onClick={apply}>
          {t("common.apply")}
        </button>
      </div>
    </div>
  );
}
