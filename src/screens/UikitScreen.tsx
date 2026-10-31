/**
 * Витрина UI-кита (Настройки → три тапа по версии) — в новом дизайне.
 * Сверху новый кит: палитра, типографика, иконки Iconoir, объёмные иконки, кнопки, списки как в настройках
 * (пункты, переключатели, радиокнопки, поля), навигация (вкладки с лентой, нижняя панель), заготовки
 * загрузки и описание переходов. Ниже — компоненты старого кита (1.3.1), перекрашенные под новый:
 * Button, Select, FilterDropdown, Slider, Toggle, ViewToggle, SwipeableTabStrip, NhModal, Toast и т. д.
 * Это экран для разработки, поэтому новые подписи — по-русски, без словаря.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../i18n/I18nContext";
import {
  Button,
  FilterDropdown,
  ICON_NAMES,
  Icon,
  IconBtn,
  KeyInputModal,
  ListField,
  ListGroup,
  ListHint,
  ListRow,
  LoadingSpinner,
  NhModal,
  NoResultsPanel,
  PageTabs,
  Pager,
  RadioRow,
  Select,
  Slider,
  SwipeableTabStrip,
  SwitchRow,
  TileIcon,
  Toggle,
  ViewToggle,
  usePager,
  useToast,
  type IconName,
  type SelectItem,
} from "../ui";

/** Токены темы: CSS-переменная и подпись. */
const SWATCHES: { name: string; v: string }[] = [
  { name: "Фон", v: "--bg" },
  { name: "Поверхность", v: "--ax-surface" },
  { name: "Поверхность 2", v: "--ax-surface-2" },
  { name: "Панель", v: "--ax-nav" },
  { name: "Выбранное", v: "--ax-selected" },
  { name: "На выбранном", v: "--ax-on-selected" },
  { name: "Акцент", v: "--accent" },
  { name: "Текст", v: "--txt" },
  { name: "Вторичный", v: "--sub" },
  { name: "Третичный", v: "--ax-muted" },
  { name: "Иконки панели", v: "--ax-nav-icon" },
  { name: "Новое", v: "--new-badge-bg" },
];

const TYPE_SCALE: { name: string; style: CSSProperties }[] = [
  { name: "Заголовок экрана · 28/700", style: { fontSize: 28, fontWeight: 700, lineHeight: "34px" } },
  { name: "Имя аккаунта · 24/700", style: { fontSize: 24, fontWeight: 700, lineHeight: "30px" } },
  { name: "Шапка · 22/700", style: { fontSize: 22, fontWeight: 700 } },
  { name: "Название книги · 19/600", style: { fontSize: 19, fontWeight: 600, lineHeight: "25px" } },
  { name: "Пункт списка · 17/500", style: { fontSize: 17, fontWeight: 500 } },
  { name: "Текст · 15/400", style: { fontSize: 15, lineHeight: "22px" } },
  { name: "Подпись · 14/400", style: { fontSize: 14, color: "var(--sub)" } },
  { name: "Заголовок группы · 15/600 акцент", style: { fontSize: 15, fontWeight: 600, color: "var(--accent)" } },
];

const TILES: { icon: IconName; color: string }[] = [
  { icon: "user", color: "#2f9be8" },
  { icon: "language", color: "#5b7cf0" },
  { icon: "palette", color: "#e8594f" },
  { icon: "smartphone", color: "#4cae5b" },
  { icon: "grid", color: "#f0973b" },
  { icon: "database", color: "#9a6ae0" },
  { icon: "dice", color: "#e0a23b" },
  { icon: "discord", color: "#5865f2" },
  { icon: "shield", color: "#e5484d" },
  { icon: "key", color: "#3fb950" },
];

const MOTIONS: { name: string; text: string }[] = [
  { name: "Вперёд", text: "Экран выезжает справа поверх, нижний уходит на 25% влево и темнеет · 300 мс" },
  { name: "Назад", text: "Экран сжимается до 92%, скругляется и уезжает вправо · 300 мс" },
  { name: "Свайп назад", text: "То же вслед за пальцем; дальше трети ширины — шаг назад" },
  { name: "Разделы панели", text: "Содержимое листается вбок на всю ширину, шапка стоит · 180 мс" },
  { name: "Вкладки", text: "Лента со snap, пилюля едет за пальцем по доле прокрутки" },
  { name: "Нижняя панель", text: "Подложка проявляется, подпись раскрывается · 250 мс" },
];

const DEMO_NAV: { icon: IconName; label: string }[] = [
  { icon: "home", label: "Главная" },
  { icon: "users", label: "Персонажи" },
  { icon: "settings", label: "Настройки" },
  { icon: "user", label: "Профиль" },
];

export function UikitScreen() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [loadingWhich, setLoadingWhich] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [selectValue, setSelectValue] = useState<string | number>("b");
  const [period, setPeriod] = useState("new");
  const [sliderValue, setSliderValue] = useState(60);
  const [volumeValue, setVolumeValue] = useState(100);
  const [keyInputVisible, setKeyInputVisible] = useState(false);
  const [keyInputValue, setKeyInputValue] = useState("");
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [tab, setTab] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [sw1, setSw1] = useState(true);
  const [sw2, setSw2] = useState(false);
  const [radio, setRadio] = useState("ru");
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [navActive, setNavActive] = useState(0);
  const progressTimer = useRef<number | null>(null);
  const pager = usePager(3, 0);

  const startLoading = useCallback((key: string) => {
    setLoadingWhich(key);
    window.setTimeout(() => setLoadingWhich(null), 2000);
  }, []);

  const startProgress = () => {
    if (progressTimer.current !== null) return;
    setProgress(0);
    progressTimer.current = window.setInterval(() => {
      setProgress((p) => {
        const next = (p ?? 0) + 0.1;
        if (next >= 1 && progressTimer.current !== null) {
          window.clearInterval(progressTimer.current);
          progressTimer.current = null;
          window.setTimeout(() => setProgress(null), 1200);
        }
        return Math.min(1, next);
      });
    }, 200);
  };
  useEffect(
    () => () => {
      if (progressTimer.current !== null) window.clearInterval(progressTimer.current);
    },
    [],
  );

  const periodOptions: SelectItem[] = [
    { value: "new", label: t("uikit.periodNew") },
    { value: "today", label: t("uikit.periodToday") },
    { value: "week", label: t("uikit.periodWeek") },
    { value: "month", label: t("uikit.periodMonth") },
    { value: "all", label: t("uikit.periodAll") },
    {
      type: "submenu",
      label: t("uikit.dateFilterSubmenu"),
      backLabel: t("uikit.back"),
      icon: <Icon name="calendar" size={15} />,
      children: [
        { value: "24h", label: t("uikit.datePreset24h") },
        { value: "7d", label: t("uikit.datePreset7d") },
        { value: "30d", label: t("uikit.datePreset30d") },
      ],
    },
  ];

  const tabs = [
    { label: t("menu.home"), icon: (c: string) => <Icon name="home" size={16} color={c} /> },
    { label: t("menu.favorites"), icon: (c: string) => <Icon name="bookmark" size={16} color={c} /> },
    { label: t("menu.history"), icon: (c: string) => <Icon name="clock" size={16} color={c} /> },
    { label: t("menu.settings"), icon: (c: string) => <Icon name="settings" size={16} color={c} /> },
  ];

  const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  return (
    <div className="screen-scroll uk-page">
      <header className="uk-hero">
        <h1>UI-кит</h1>
        <p>Новый дизайн: тёмная тема Anixart, списки в духе Telegram, иконки Iconoir. Ниже — старые компоненты в новом виде.</p>
      </header>

      {/* ── Новый кит ── */}
      <ListGroup title="Палитра">
        <div className="uk-body">
          <div className="uk-swatches">
            {SWATCHES.map((s) => (
              <div key={s.v} className="uk-swatch">
                <span className="uk-swatch-chip" style={{ background: `var(${s.v})` }} />
                <span className="uk-swatch-name">{s.name}</span>
                <span className="uk-swatch-value">{css(s.v) || s.v}</span>
              </div>
            ))}
          </div>
        </div>
      </ListGroup>
      <ListHint>Оттенок «выбранного» и акцента берётся из цвета темы в настройках; поверхности нейтральные.</ListHint>

      <ListGroup title="Типографика · MedeoSans">
        <div className="uk-body">
          {TYPE_SCALE.map((x) => (
            <div key={x.name} className="uk-type">
              <span className="uk-type-name">{x.name}</span>
              <span style={{ color: "var(--txt)", ...x.style }}>{t("uikit.typographySample")}</span>
            </div>
          ))}
        </div>
      </ListGroup>

      <ListGroup title="Объёмные иконки">
        <div className="uk-body">
          <div className="uk-tiles">
            {TILES.map((x) => (
              <TileIcon key={x.icon} icon={x.icon} color={x.color} />
            ))}
          </div>
        </div>
      </ListGroup>

      <ListGroup title={`Иконки Iconoir · ${ICON_NAMES.length}`}>
        <div className="uk-body">
          <div className="uk-icons">
            {ICON_NAMES.map((n) => (
              <button key={n} type="button" className="uk-icon" title={n} onClick={() => showToast({ title: n })}>
                <Icon name={n} size={24} />
                <span>{n}</span>
              </button>
            ))}
          </div>
        </div>
      </ListGroup>
      <ListHint>Обводка 2. Залитые варианты (solid): heart, star, bookmark, book.</ListHint>

      <ListGroup title="Кнопки">
        <div className="uk-body">
          <div className="uk-row">
            <button type="button" className="ax-btn ax-btn-primary">
              <Icon name="log-in" size={18} />
              Основная
            </button>
            <button type="button" className="ax-btn ax-btn-ghost">
              <Icon name="log-out" size={18} />
              Вторичная
            </button>
            <button type="button" className="ax-icon-btn" aria-label="search">
              <Icon name="search" size={22} />
            </button>
            <Icon name="heart" size={24} solid />
          </div>
        </div>
      </ListGroup>

      <ListGroup title="Списки">
        <ListRow icon="user" color="#2f9be8" title="Пункт с подписью" sub="Открывает свою страницу" onPress={() => showToast({ title: "ListRow" })} />
        <ListRow
          icon="discord"
          color="#5865f2"
          title="Внешняя ссылка"
          sub="Своя иконка справа"
          trailing={<Icon name="arrow-up-right" size={18} />}
          onPress={() => showToast({ title: "ListRow" })}
        />
        <SwitchRow title="Переключатель" description="Срабатывает от нажатия на всю строку" value={sw1} onChange={setSw1} />
        <SwitchRow title="Ещё один" value={sw2} onChange={setSw2} />
      </ListGroup>
      <ListHint>Пояснение под карточкой — как под группами в Telegram.</ListHint>

      <ListGroup title="Выбор одного">
        <RadioRow title="Русский" sub="Russian" checked={radio === "ru"} onSelect={() => setRadio("ru")} />
        <RadioRow title="English" checked={radio === "en"} onSelect={() => setRadio("en")} />
        <RadioRow title="日本語" sub="Japanese" checked={radio === "ja"} onSelect={() => setRadio("ja")} />
      </ListGroup>

      <ListGroup title="Поля">
        <ListField value={name} placeholder="Имя пользователя" onChange={setName} />
        <ListField value={about} placeholder="О себе" multiline onChange={setAbout} />
      </ListGroup>

      <ListGroup title="Вкладки и лента">
        <div className="uk-body">
          <div className="uk-pager">
            <PageTabs
              pager={pager}
              tabs={[
                { key: "a", label: "Моя" },
                { key: "b", label: "Новое" },
                { key: "c", label: "Закладки" },
              ]}
            />
            <Pager pager={pager} count={3} render={(i) => <div className="uk-pager-page">Страница {i + 1} — листается свайпом</div>} />
          </div>
        </div>
      </ListGroup>

      <ListGroup title="Нижняя панель">
        <div className="uk-body">
          <div className="uk-nav-demo">
            <nav className="ax-nav">
              <div className="ax-nav-pill">
                {DEMO_NAV.map((x, i) => (
                  <button key={x.label} type="button" className={i === navActive ? "ax-nav-item is-active" : "ax-nav-item"} onClick={() => setNavActive(i)}>
                    <span className="ax-nav-icon">
                      <Icon name={x.icon} size={24} />
                    </span>
                    <span className="ax-nav-label">{x.label}</span>
                  </button>
                ))}
              </div>
            </nav>
          </div>
        </div>
      </ListGroup>

      <ListGroup title="Загрузка">
        <div className="uk-body">
          <div className="uk-skeleton">
            <span className="uk-skeleton-cover uk-shimmer" />
            <span className="uk-skeleton-lines">
              <span className="uk-shimmer" style={{ height: 22, width: "80%" }} />
              <span className="uk-shimmer" style={{ height: 14, width: "45%" }} />
              <span className="uk-shimmer" style={{ height: 60 }} />
            </span>
          </div>
          <LoadingSpinner message={t("common.loading")} />
        </div>
      </ListGroup>

      <ListGroup title="Переходы">
        <div className="uk-body">
          <div className="uk-motion">
            {MOTIONS.map((m) => (
              <div key={m.name} className="uk-motion-card">
                <b>{m.name}</b>
                <span>{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      </ListGroup>

      {/* ── Старый кит в новом виде ── */}
      <header className="uk-hero">
        <h1>Компоненты 1.3.1</h1>
        <p>Те же компоненты, что в старом приложении, перекрашенные под новый дизайн.</p>
      </header>

      <ListGroup title={t("uikit.buttonTitle")}>
        <div className="uk-body">
          <div className="uk-row">
            <Button title={t("uikit.buttonPrimary")} variant="primary" onLongPress={() => showToast({ title: "long press" })} />
            <Button title={t("uikit.buttonSecondary")} variant="secondary" />
            <Button title={t("uikit.buttonOutline")} variant="outline" />
            <Button title={t("uikit.buttonCompact")} variant="primary" compact />
            <Button title={t("uikit.buttonGhost")} variant="ghost" />
            <Button title={t("uikit.buttonChip")} variant="chip" />
          </div>
          <div className="uk-row">
            {(["primary", "secondary", "outline"] as const).map((v) => (
              <Button
                key={v}
                title={t("uikit.loadingWithText")}
                variant={v}
                compact
                loading={loadingWhich === v}
                loadingLabel={t("uikit.loadingLabel")}
                onPress={() => startLoading(v)}
              />
            ))}
            <Button title={t("uikit.download")} variant="secondary" progress={progress ?? undefined} onPress={startProgress} />
          </div>
          <div className="uk-row">
            <Button title={t("uikit.download")} variant="primary" iconGap={10} leftIcon={(c) => <Icon name="download" size={18} color={c} />} />
            <Button title="" variant="primary" iconOnly accessibilityLabel={t("uikit.favorite")} leftIcon={(c) => <Icon name="heart" size={20} color={c} />} />
            <Button title="" variant="ghost" iconOnly accessibilityLabel={t("uikit.settings")} leftIcon={(c) => <Icon name="settings" size={20} color={c} />} />
            <Button title={t("uikit.settings")} variant="chip" iconGap={6} leftIcon={(c) => <Icon name="settings" size={16} color={c} />} />
            <IconBtn accessibilityLabel={t("menu.random")} shape="circle" onPress={() => showToast({ title: t("menu.random") })}>
              <Icon name="shuffle" size={18} />
            </IconBtn>
          </div>
        </div>
      </ListGroup>

      <ListGroup title={`${t("uikit.selectTitle")} · ${t("uikit.filterTitle")}`}>
        <div className="uk-body">
          <Select
            label="Framework"
            description="Простой выбор из списка."
            value={selectValue}
            onChange={setSelectValue}
            options={[
              { value: "a", label: "Option A" },
              { value: "b", label: "Option B" },
              { value: "c", label: "Option C" },
            ]}
            defaultValue="b"
            resetText={t("uikit.sliderReset")}
            placeholder={t("uikit.selectPlaceholder")}
          />
          <div className="uk-row">
            <FilterDropdown
              value={period}
              onChange={setPeriod}
              options={periodOptions}
              keepOpen
              trigger={({ onPress }) => (
                <Button title={t("uikit.filterButton")} variant="ghost" iconGap={6} leftIcon={(c) => <Icon name="filter" size={16} color={c} />} onPress={onPress} />
              )}
            />
            <FilterDropdown
              value={period}
              onChange={setPeriod}
              options={periodOptions}
              variant="chip"
              resetLabel={t("uikit.selectReset")}
              onReset={() => setPeriod("new")}
            />
          </div>
        </div>
      </ListGroup>

      <ListGroup title={t("uikit.sliderTitle")}>
        <div className="uk-body">
          <Slider label={t("uikit.sliderOpacity")} min={0} max={100} value={sliderValue} onChange={setSliderValue} unit="%" />
          <Slider
            label={t("uikit.sliderVolume")}
            min={0}
            max={100}
            value={volumeValue}
            onChange={setVolumeValue}
            defaultValue={100}
            unit="%"
            resetText={t("uikit.sliderReset")}
            description="Тап по значению в центре открывает ввод."
          />
          <Button
            title={t("uikit.keyInputModalOpenButton")}
            variant="secondary"
            compact
            onPress={() => {
              setKeyInputValue(String(volumeValue));
              setKeyInputVisible(true);
            }}
          />
        </div>
      </ListGroup>
      <KeyInputModal
        visible={keyInputVisible}
        onClose={() => setKeyInputVisible(false)}
        value={keyInputValue}
        onChangeText={setKeyInputValue}
        onSubmit={(val) => {
          const n = parseInt(val, 10);
          if (!Number.isNaN(n)) setVolumeValue(Math.min(100, Math.max(0, n)));
        }}
        label={t("uikit.sliderVolume")}
        inputMode="numeric"
      />

      <ListGroup title={`${t("uikit.toggleTitle")} · ViewToggle · SwipeableTabStrip`}>
        <div className="uk-body">
          <Toggle
            label={t("uikit.toggleEnableLabel")}
            value={featureEnabled}
            onValueChange={setFeatureEnabled}
            enabledText={t("uikit.toggleOn")}
            disabledText={t("uikit.toggleOff")}
            defaultValue={false}
            resetText={t("uikit.sliderReset")}
          />
          <ViewToggle
            options={[
              { value: "list", label: "List", icon: (c) => <Icon name="list" size={18} color={c} /> },
              { value: "grid", label: "Grid", icon: (c) => <Icon name="grid" size={18} color={c} /> },
            ]}
            value={viewMode}
            onChange={setViewMode}
          />
          <SwipeableTabStrip tabs={tabs} selectedIndex={tab} onSelectIndex={setTab} />
        </div>
      </ListGroup>

      <ListGroup title="NhModal · Toast">
        <div className="uk-body">
          <div className="uk-row">
            <Button title="NhModal" variant="secondary" compact onPress={() => setSheet(true)} />
            <Button title="Toast: info" variant="chip" onPress={() => showToast({ title: t("uikit.title"), message: t("uikit.typographySample") })} />
            <Button title="Toast: success" variant="chip" onPress={() => showToast({ type: "success", title: t("favorites.import.doneTitle") })} />
            <Button
              title="Toast: error"
              variant="chip"
              onPress={() => showToast({ type: "error", title: t("toast.errorTitle"), message: t("toast.genericFailure") })}
            />
          </div>
        </div>
      </ListGroup>
      <NhModal visible={sheet} onClose={() => setSheet(false)} title={t("uikit.title")} hint={[t("uikit.placeholder")]}>
        <div className="uikit-sheet-body">
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i}>
              {i + 1}. {t("uikit.typographySample")}
            </p>
          ))}
        </div>
      </NhModal>

      <ListGroup title="NoResultsPanel">
        <div className="uk-body">
          <NoResultsPanel
            title={t("explore.noResults.title.general")}
            subtitle={t("common.nothingFound")}
            actions={[
              { label: t("explore.sort.popularMonth"), onPress: () => {} },
              { label: t("common.reset"), onPress: () => {} },
            ]}
          />
        </div>
      </ListGroup>
    </div>
  );
}
