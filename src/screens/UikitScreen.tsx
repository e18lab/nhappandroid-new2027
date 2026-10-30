/**
 * Витрина UI-кита — аналог старого `app/uikit.tsx` (Настройки → три тапа по версии).
 * Те же примеры и подписи (`uikit.*` из старого словаря) + новые обёртки: шторка, тост, пустые состояния.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import {
  Button,
  FilterDropdown,
  Icon,
  IconBtn,
  KeyInputModal,
  LoadingSpinner,
  NhModal,
  NoResultsPanel,
  Select,
  Slider,
  SwipeableTabStrip,
  Toggle,
  Typography,
  ViewToggle,
  useToast,
  type SelectItem,
  type TypographyVariant,
} from "../ui";

const TYPE_VARIANTS: TypographyVariant[] = ["h1", "h2", "h3", "h4", "body", "bodySmall", "caption", "label", "overline"];

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
  const progressTimer = useRef<number | null>(null);

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
  useEffect(() => () => {
    if (progressTimer.current !== null) window.clearInterval(progressTimer.current);
  }, []);

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
        {
          type: "submenu",
          label: t("uikit.dateCustomRange"),
          backLabel: t("uikit.back"),
          icon: <Icon name="calendar" size={15} />,
          children: [{ value: "custom", label: t("uikit.dateCustomPick") }],
        },
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
    { label: t("menu.recommendations"), icon: (c: string) => <Icon name="star" size={16} color={c} /> },
    { label: t("menu.settings"), icon: (c: string) => <Icon name="settings" size={16} color={c} /> },
  ];

  return (
    <div className="screen uikit">
      <h1 className="screen-title">{t("uikit.title")}</h1>

      <h2 className="uikit-title">{t("uikit.typographyTitle")}</h2>
      {TYPE_VARIANTS.map((v) => (
        <div key={v} className="uikit-type-row">
          <div className="uikit-type-name">{v}</div>
          <Typography variant={v}>{t("uikit.typographySample")}</Typography>
        </div>
      ))}

      <h2 className="uikit-title">{t("uikit.buttonTitle")}</h2>
      <div className="uikit-row">
        <Button title={t("uikit.buttonPrimary")} variant="primary" onLongPress={() => showToast({ title: "long press" })} />
        <Button title={t("uikit.buttonSecondary")} variant="secondary" />
        <Button title={t("uikit.buttonOutline")} variant="outline" />
        <Button title={t("uikit.buttonCompact")} variant="primary" compact />
        <Button title={t("uikit.buttonGhost")} variant="ghost" />
        <Button title={t("uikit.buttonChip")} variant="chip" />
      </div>

      <h2 className="uikit-title">{t("uikit.loadingTitle")}</h2>
      <div className="uikit-row">
        {(["primary", "secondary", "outline"] as const).map((v) => (
          <Button
            key={v}
            title={t("uikit.loadingWithText")}
            variant={v}
            loading={loadingWhich === v}
            loadingLabel={t("uikit.loadingLabel")}
            onPress={() => startLoading(v)}
          />
        ))}
        <Button
          title=""
          variant="primary"
          iconOnly
          leftIcon={(c) => <Icon name="loader" size={20} color={c} />}
          loading={loadingWhich === "icon-p"}
          accessibilityLabel={t("uikit.loadingLabel")}
          onPress={() => startLoading("icon-p")}
        />
        <Button
          title=""
          variant="ghost"
          iconOnly
          leftIcon={(c) => <Icon name="loader" size={20} color={c} />}
          loading={loadingWhich === "icon-g"}
          accessibilityLabel={t("uikit.loadingLabel")}
          onPress={() => startLoading("icon-g")}
        />
        <Button
          title={t("uikit.download")}
          variant="secondary"
          progress={progress ?? undefined}
          onPress={startProgress}
        />
      </div>

      <h2 className="uikit-title">{t("uikit.iconsTitle")}</h2>
      <div className="uikit-row">
        <Button title={t("uikit.download")} variant="primary" iconGap={10} leftIcon={(c) => <Icon name="download" size={18} color={c} />} />
        <Button title={t("uikit.download")} variant="outline" rightIcon={(c) => <Icon name="download" size={18} color={c} />} />
        <Button title="" variant="primary" iconOnly accessibilityLabel={t("uikit.favorite")} leftIcon={(c) => <Icon name="heart" size={20} color={c} />} />
        <Button title="" variant="ghost" iconOnly accessibilityLabel={t("uikit.settings")} leftIcon={(c) => <Icon name="settings" size={20} color={c} />} />
        <Button title={t("uikit.settings")} variant="chip" iconGap={6} leftIcon={(c) => <Icon name="settings" size={16} color={c} />} />
        <IconBtn accessibilityLabel={t("menu.random")} shape="circle" onPress={() => showToast({ title: t("menu.random") })}>
          <Icon name="shuffle" size={18} />
        </IconBtn>
      </div>

      <h2 className="uikit-title">{t("uikit.selectTitle")}</h2>
      <Select
        label="Framework"
        description="Простой выбор из списка. Триггер с hover на ПК."
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

      <h2 className="uikit-title">{t("uikit.filterTitle")}</h2>
      <div className="uikit-row">
        <FilterDropdown
          value={period}
          onChange={setPeriod}
          options={periodOptions}
          keepOpen
          description="Фильтр с вложенным меню (период, свой диапазон дат)."
          trigger={({ onPress }) => (
            <Button
              title={t("uikit.filterButton")}
              variant="ghost"
              iconGap={6}
              leftIcon={(c) => <Icon name="filter" size={16} color={c} />}
              onPress={onPress}
            />
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

      <h2 className="uikit-title">{t("uikit.sliderTitle")}</h2>
      <div className="uikit-col">
        <Slider
          label={t("uikit.sliderOpacity")}
          min={0}
          max={100}
          value={sliderValue}
          onChange={setSliderValue}
          unit="%"
          description="Прозрачность элемента. Сброс выключен (нет defaultValue)."
        />
        <Slider
          label={t("uikit.sliderVolume")}
          min={0}
          max={100}
          value={volumeValue}
          onChange={setVolumeValue}
          defaultValue={100}
          unit="%"
          resetText={t("uikit.sliderReset")}
          description="Громкость. Тап по значению в центре открывает ввод."
        />
      </div>

      <h2 className="uikit-title">
        {t("uikit.keyInputModalTitle")} ({t("uikit.keyInputModalOnlyAndroid")})
      </h2>
      <Button
        title={t("uikit.keyInputModalOpenButton")}
        compact
        onPress={() => {
          setKeyInputValue(String(volumeValue));
          setKeyInputVisible(true);
        }}
      />
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

      <h2 className="uikit-title">{t("uikit.toggleTitle")}</h2>
      <Toggle
        label={t("uikit.toggleEnableLabel")}
        value={featureEnabled}
        onValueChange={setFeatureEnabled}
        enabledText={t("uikit.toggleOn")}
        disabledText={t("uikit.toggleOff")}
        defaultValue={false}
        resetText={t("uikit.sliderReset")}
        description="Подсказка под переключателем. Сброс — по желанию (defaultValue)."
      />

      <h2 className="uikit-title">ViewToggle</h2>
      <ViewToggle
        options={[
          { value: "list", label: "List", icon: (c) => <Icon name="list" size={18} color={c} /> },
          { value: "grid", label: "Grid", icon: (c) => <Icon name="grid" size={18} color={c} /> },
        ]}
        value={viewMode}
        onChange={setViewMode}
        description="Режим отображения: список или сетка."
      />

      <h2 className="uikit-title">SwipeableTabStrip</h2>
      <SwipeableTabStrip tabs={tabs} selectedIndex={tab} onSelectIndex={setTab} />

      <h2 className="uikit-title">NhModal · Toast</h2>
      <div className="uikit-row">
        <Button title="NhModal" variant="secondary" compact onPress={() => setSheet(true)} />
        <Button
          title="Toast: info"
          variant="chip"
          onPress={() => showToast({ title: t("uikit.title"), message: t("uikit.typographySample") })}
        />
        <Button title="Toast: success" variant="chip" onPress={() => showToast({ type: "success", title: t("favorites.import.doneTitle") })} />
        <Button title="Toast: error" variant="chip" onPress={() => showToast({ type: "error", title: t("toast.errorTitle"), message: t("toast.genericFailure") })} />
      </div>
      <NhModal
        visible={sheet}
        onClose={() => setSheet(false)}
        title={t("uikit.title")}
        hint={[t("uikit.placeholder")]}
      >
        <div className="uikit-sheet-body">
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i}>
              {i + 1}. {t("uikit.typographySample")}
            </p>
          ))}
        </div>
      </NhModal>

      <h2 className="uikit-title">NoResultsPanel · LoadingSpinner</h2>
      <NoResultsPanel
        title={t("explore.noResults.title.general")}
        subtitle={t("common.nothingFound")}
        actions={[
          { label: t("explore.sort.popularMonth"), onPress: () => {} },
          { label: t("common.reset"), onPress: () => {} },
        ]}
      />
      <div className="uikit-spinner-box">
        <LoadingSpinner message={t("common.loading")} />
      </div>
    </div>
  );
}
