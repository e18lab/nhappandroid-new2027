# План переноса NHApp: `D:\nhappandroid` → `D:\nhappandroid-new2027`

Старое: Expo 55 / React Native + Electron, ~52 тыс. строк, 17 экранов.
**Источник — ветка `master` старого репозитория** (стабильный дизайн). Ветку `new-ui`
(плавающая панель `BrowseFloatingBar`, шторка `BrowseOptionsSheet`, префикс ключей `NHENTAI_`) не переносим.
Новое: Tauri 2 + React 19 + Vite + react-router, ~1,2 тыс. строк.

Цель: тот же дизайн и поведение, новая обёртка. Идём сверху вниз: каждый пункт делается
целиком, проверяется и отмечается `[x]`. Пункты внутри этапа идут в порядке зависимостей.

Легенда: **Старое** — где лежит код-образец. **Готово, когда** — как проверить.

---

## Что уже есть в новом приложении

- [x] Каркас Tauri 2 + Vite, прокси `/nh-api` для браузера, CSP и http-плагин для nhentai.net
- [x] Тема: HSB от базового оттенка (`src/theme.ts`), CSS-переменные
- [x] Оболочка: боковое меню (Библиотека, «Мне повезёт», Discord, «Войти»), поиск в шапке (`src/shell/Shell.tsx`)
- [x] Каталог: сетка, 5 сортировок, пагинация, поиск по строке (`HomeScreen`)
- [x] Страница книги: обложка, теги по группам, закладка (`BookScreen`)
- [x] Простая читалка: горизонтальная лента (`ReaderScreen`)
- [x] Локальные закладки и история (`src/lib/library.ts`) — **но с другими ключами и форматом, см. 0.3**
- [x] Настройки: только ползунок оттенка
- [ ] Заглушки: Персонажи, Рекомендации (Загруженное, Онлайн-избранное и вход уже сделаны)

---

## Этап 0. Фундамент (без него дальше всё придётся переделывать)

### 0.1 Android-сборка Tauri
- [x] `tauri android init`, debug-APK собран и проверен на эмуляторе (API 36, x86_64)
- [x] Иконка из старого `assets/images/icon.png`, тёмный фон окна и иконки, светлые значки статус-бара
- [x] Версия 1.4.0, `versionCode` 10400, подпись старым ключом — ставится обновлением поверх 1.3.1 (см. «Обновление поверх 1.3.1»)
- [x] Системная кнопка «Назад»: закрывает меню → назад по истории → выход (`src/shell/androidBack.ts`); safe-area сверху/снизу/по бокам
- [x] Таймаут 20 с на запросы к API (раньше первый запрос без сети висел вечно)
- **Готово:** каталог, обложки, книга, меню и «Назад» работают на Android.

Команды: `npm run android:dev`, `npm run android:build -- --target aarch64` (телефон) / `x86_64` (эмулятор), `npm run android:release`.
Скрипт `scripts/tauri-android.mjs` сам находит SDK/NDK/JDK. Без «Режима разработчика» Windows Tauri не может
создать символическую ссылку на `.so` — скрипт тогда копирует её и доводит сборку через Gradle.

### 0.2 Картинки с CDN
- [x] Логика путей и запасных адресов → `src/api/media.ts`: `normalizeMediaPath` (`.webp.webp`), `thumbUrl`/`imageUrl` (с заменой старых хостов `i.`/`t.`), `thumbSources` (все t-зеркала × thumb↔cover × расширения), `pageSources` (все i-зеркала × расширения), `/config` → `/cdn` → значения по умолчанию
- [x] `Referer` проверен: CDN отдаёт и страницы, и превью без него (и с `Referer` от `tauri.localhost`) — хватает обычного `<img>`, blob-загрузка не нужна. Обложки — только с `t*`, с `i*` ошибка
- [x] `src/components/SmartImage.tsx` — порт `SmartImageWithRetry`: перебор адресов, до 3 повторов с паузой 1/2/3 с, спиннер, ленивая загрузка; `Cover.tsx` удалён
- [x] Исправлена читалка: `/galleries/{id}/pages` в API v2 отдаёт 404, страницы берутся из `getGallery().pages` (как в старом `galleryToBook`)
- **Готово:** обложки, книга и страницы читалки грузятся на Android (эмулятор API 36).

### 0.3 Хранилище и ключи
- [x] `src/lib/storage.ts` — обёртка над `localStorage` (get/set/remove, JSON, `getAll`, подписка на изменения) и список ключей `KEYS` из `master`, без префикса
- [x] `src/lib/library.ts` в формате `master`: `bookFavorites` — `number[]` (старые → новые), `readHistory` — `[id, страница с 0, всего, unix-сек][]` (новые первыми, пишет только читалка), `searchHistory` — `string[]` до 10
- [x] `src/lib/bookCards.ts` — данные карточек по id: кеш из каталога + `getGallery` по 6 параллельно (как `hydrateMissingThumbnails`). Пакетная загрузка через nhapp-api — этап 8
- [x] Закладки и история показывают карточки по id; в истории — «стр. N из M»
- [x] `theme.ts` → ключ `themeHue`; без значения оттенок 0°, как в старом (`Number(null)` = 0)
- [x] `src/lib/migrateLegacyKeys.ts`: `nhapp.favorites` → `bookFavorites`, `nhapp.themeHue` → `themeHue`, `nhapp.history` удаляется (другой смысл — «открытые», а не прочитанные)
- [x] Исправлен вечный спиннер у картинок из кеша в `SmartImage`
- **Готово:** данные в формате старого приложения читаются и пишутся, проверено на эмуляторе.

### 0.4 Локализация
- [x] `src/i18n/I18nContext.tsx` — порт старого `I18nProvider`: ключ `app_language` (`system | en | ru | zh | ja`), `t(key, params)`, запасной язык — английский, системный язык из `navigator.language` (uk/be → ru)
- [x] Словари скопированы без изменений в `src/i18n/locales/` (ru 630, en 628, ja/zh 601 ключ)
- [x] Строки нового приложения, которых нет в старых словарях, — в `src/i18n/additions.ts` на 4 языка (заглушки экранов, подписи читалки, тексты ошибок). Когда экран переносится целиком, временные строки отсюда убираются
- [x] Все экраны на `t()`: меню, каталог (подписи сортировок как в старом — «Популярное сегодня» и т.д.), книга, читалка, закладки, история, настройки. Ошибки API переводятся через `ApiError.i18nKey`
- [x] Временный выбор языка в настройках (чипами); полноценный `LanguageSelector` — этап 9
- [ ] Даты (`date-fns` локали, `timeAgo`) — когда понадобятся (этап 5)
- **Готово:** смена языка мгновенно переводит меню, каталог, книгу и настройки; проверено на эмуляторе (en/ru/ja).

### 0.5 UI-кит и общие обёртки
Старое: `components/uikit/*`, `components/ui/*`, `app/uikit.tsx` (витрина).
- [x] Шрифт: в старом системный (Roboto на Android), `SpaceMono` не используется — стек `Roboto, system-ui`
- [x] Полная палитра из 22 цветов старой темы в `src/theme.ts` → CSS-переменные (`surfaceElevated` → `--surface-elevated`), `contrastTextOn` → `--on-accent`
- [x] `src/ui/`: `Button` (5 вариантов, compact, loading, кольцо прогресса, иконки, долгое нажатие), `CardPressable`, `IconBtn`, `Toggle`, `Slider` (перетаскивание, тап, ручной ввод), `Select`, `FilterDropdown` (группы, действия, подменю, свой контент + выбор поверх), `ViewToggle`, `SwipeableTabStrip`, `KeyInputModal`, `Typography`, `Section`, стили в `src/ui/ui.css`
- [x] `NhModal` (нижняя шторка), `OverlayPortalProvider`, `ToastProvider` / `useToast` — подключены в `App.tsx`
- [x] `LoadingSpinner` / `Spinner`, `NoResultsPanel`
- [x] `src/ui/Icon.tsx` — `<Icon name="…">` с именами Feather из старого кода (все 70 иконок старого приложения → lucide)
- [x] «Назад» и Escape закрывают верхний оверлей (меню, подменю, шторка, ввод) — `useBackHandler`; без истории «Назад» ведёт на главную, а выход — только с главной
- [x] Витрина `/uikit` — те же примеры и подписи, что в старом `app/uikit.tsx`; открывается тремя тапами по версии в настройках
- [ ] `BottomNavBar` (этап 2) — переносится вместе со своим экраном. `Graph` не нужен: в старом он только на демо-странице UI-кита
- **Готово:** витрина проверена на эмуляторе: кнопки, селектор, фильтр с подменю, слайдеры, переключатели, вкладки, шторка, тосты.

### 0.6 Полный API-клиент v2
Старое: `api/v2/*` (клиент, токены, refresh), `api/v2/compat.ts` (модель `Book`).
- [x] `client.ts`: `nhApi.get/post/put/delete`, `User <token>` / `Key <key>` (ключ из `VITE_NHENTAI_API_KEY`), авто-refresh при 401, `buildQuery`, повторы на 429, признак Cloudflare (`ApiError.isCloudflare`). Токены в тех же ключах `@auth.v2.*`
- [x] Модель `Book` и конвертеры (`galleryToBook`, `galleryCardToBook`, `galleryRelatedToBook`)
- [x] Модули: `galleries` (+ избранное, правка тегов), `galleryBrowse` (один тег → `/galleries/tagged`, уже подключён к главной), `search` (+ `buildV2Query`), `tags` (автодополнение), `comments`, `auth`, `account` (favorites, blacklist, user, users), `config` (PoW с проверенным SHA-256, captcha)
- Не перенесено: `/galleries/{id}/pages` — у API его нет (404), страницы берутся из `getGallery`; очистка данных при выходе — на этапе 6.
- **Готово:** `tsc` без ошибок; на живом API проверены каталог, `/galleries/tagged` (5980 стр. у english), автодополнение, `/pow` и решение PoW.

---

## Перенос дизайна экранов (вне очереди, по релизу 1.3.1 / ветке `master`)

Экраны, сделанные до переноса, переписаны заново по коду старого приложения:
- [x] Каркас: меню под содержимым (`drawerType="back"`), шапка-заголовок с поиском, фильтрами и тегами (`src/shell/TopBar.tsx`, `SideMenu.tsx`)
- [x] Каталог и «Обзор»: карточка `BookCardClassic`, сетка из `grid_config_map_v2`, `PaginationBar` со шторкой, бесконечная прокрутка, плашка «ничего не найдено»
- [x] Поиск (`app/search.tsx`): недавние запросы, подсказки, переход по номеру
- [x] Книга: баннер и обложка-карточка, пилюли, «Читать / Продолжить», теги с циклом фильтра, галерея с колонками, «Похожие», кнопка вверх/вниз
- [x] Читалка: свайп по горизонтали/вертикали, разворот, «Просмотр», непрерывная лента, подсказки, баннер, миниатюры, окно настроек (`reader_last_*`)
- [x] Закладки и история: `ListSortBar`, история по дням с временем и прогрессом
- [x] Настройки: язык, палитра, переключатели, отображение, сетка каталога
- [ ] Не перенесено (свои этапы): скачивание, поиск по картинке, рекомендации, персонажи. Комментарии, вход, теги/коллекции, менеджер хранилища и календарь дат уже сделаны

## Обновление поверх 1.3.1

- [x] ID `com.nhapp.android`, версия 1.4.0 (код 10400, старая схема `1.3.2` → 10302), подпись тем же ключом, что у релиза (`src-tauri/gen/android/keystore/nhapp.keystore`, параметры в `keystore.properties`). Проверено: встаёт обновлением на телефон с 1.3.1.
- [x] Перенос данных 1.3.1: `LegacyStorage.kt` читает `databases/RKStorage` (только чтение), `src/lib/importLegacyStorage.ts` один раз переносит ключи (флаг `legacyImport.v1`). Версии `NHENTAI_*` важнее обычных, закладки/история/поиск объединяются. Проверено на телефоне: 50 закладок и 230 книг истории.

## Этап 1. Каталог и поиск (главный экран)

- [x] **Карточка книги** — `components/BookCard/index.tsx`, `design/BookCardClassic.tsx`, `BookCard.styles.ts`: обложка, язык-флаг, страницы, избранное, бейджи
- [x] **Сетка** — `components/BookList.tsx`, `config/gridConfig.ts`, `hooks/useGridConfig.ts`, `hooks/book/useColumns.ts`, `utils/browseGridPageSize.ts`: число колонок по ширине/ориентации
- [x] **Пагинация и бесконечная прокрутка** — `PaginationBar.tsx`, настройка `ui_infinite_scroll`
- [ ] **Быстрая прокрутка** — `FastScrollRail.tsx`, `utils/scrollToTop.ts`
- [x] **Контексты фильтров** — `context/SortContext`, `DateRangeContext`, `TagFilterContext`, `PageFilterContext`, `SearchContentContext`
- [x] **Строка поиска с фильтрами** — `components/SearchBar.tsx` (1042 строки в `master`): заголовок экрана, история поиска, автодополнение тегов, переход по `#id`, и в ней же выпадающие фильтры через `uikit/FilterDropdown.tsx` + `nhModal`:
  - [x] сортировка
  - [x] фильтр по дате — пресеты и свой диапазон `CalendarRangePicker.tsx` (`src/components/CalendarRangePicker.tsx`, тот же формат `dateRange:v5`)
  - [x] фильтр по числу страниц — `PagesFilterEditor` внутри `SearchBar.tsx`, `pagesFilterPref`
  - [x] язык — `galleryLanguagePref`
  - [ ] список устройств лобби (после этапа 8)
  - [x] скрытие фильтров на экране рекомендаций
- [x] **Сортировка в списках библиотеки** — `ListSortBar.tsx`
- [x] **Чёрный список** — `lib/blacklistFilter.ts` → `src/lib/blacklist.ts`: размытие карточки с плашкой, в результатах поиска такие книги убираются. Список берётся с аккаунта — заработает после входа (этап 6)
- [x] **Экран поиска** — `app/search.tsx`
- [x] **Экран «Обзор»** — `app/explore.tsx`, `TabGridContent.tsx`
- [x] **Главная** — `app/index.tsx` (845 строк в `master`): сетка + `PaginationBar` снизу, фильтры в шапке через `SearchBar`
- **Готово, когда:** главная, поиск и обзор при одинаковых фильтрах показывают то же, что старое приложение.

## Этап 2. Оболочка и навигация

- [x] **Боковое меню** — `components/SideMenu/index.tsx`, `LibraryMenuList.tsx`, `constants/Menu.ts`, `DrawerContext.tsx`: аватар/аккаунт, замки «Скоро»
- [x] **Нижняя навигация** — `uikit/BottomNavBar.tsx`: в релизе только в витрине UI-кита, на экранах не используется
- [x] **Действия в шапке** — `context/TopBarActionContext.tsx`
- [x] **Полноэкранный режим** — настройка `ui_fullscreen`: на Android скрываются статус-бар и навигация (`SystemUi.kt`, `src/shell/systemUi.ts`), состояние восстанавливается при запуске
- [ ] **Окно на ПК** — заголовок окна вместо `ElectronTitleBar.tsx` (можно отложить до этапа 11)
- **Готово, когда:** навигация между всеми экранами повторяет старую, включая «Назад».

## Этап 3. Страница книги

- [x] **Шапка книги** — `app/book/[id]/_components/BookHeader.tsx`: обложка, названия, метаданные, кнопки (читать, скачать, избранное, поделиться, копировать)
- [x] **Теги** — `components/book/TagBlock.tsx`: тап → поиск по тегу, настройка `reset_tags_on_book_tag_nav`
- [x] **Сетка страниц** — `components/book/PageItem.tsx`, `hooks/book/useWindowLayout.ts`
- [x] **Похожие** — `_components/RelatedSection.tsx`
- [x] **FAB / прокрутка** — `hooks/book/useFab.ts`
- [x] **Хуки данных** — `useBookData`, `useFavorites`, `useRelatedComments` (онлайн-избранное — этап 6)
- [x] **Кольцо прогресса скачивания** — `Ring` в `src/screens/BookScreen.tsx`
- [x] **Комментарии: просмотр** — `src/screens/CommentsScreen.tsx`, `CommentCard.tsx`: сортировка, по 20 с догрузкой, перевод через MyMemory, копирование, удаление своего. Загружаются все страницы API (в старом — только первые 50)
- [x] **Комментарии: отправка** — `src/components/CommentComposer.tsx` (после входа, см. этап 6)
- **Готово, когда:** страница книги выглядит и ведёт себя как в старом.

## Этап 4. Читалка

Старое: `app/read.tsx` (914), `components/read/*`, `PagerView.tsx`, `electron/reader.js`.
- [x] Постраничный режим (пейджер) и непрерывная лента (`reader_last_continuous`)
- [x] Разворот на две страницы, в т.ч. только в альбомной (`reader_last_dual`)
- [x] Вписывание: contain/cover (`reader_last_fit`), ориентация (`reader_last_orient`)
- [x] Перелистывание тапом по краям (`reader_last_tap`), смена руки (`reader_last_hand`)
- [x] Масштаб/пинч — `@likashefqet/react-native-image-zoom` → свой зум; режим разглядывания `InspectCanvas.tsx` (`reader_last_inspect`)
- [x] Панели управления: `ControlsMobile.tsx`, `ControlsDesktop.tsx`, `Buttons.tsx`, скрытие UI тапом
- [x] Лента миниатюр — `ThumbRail.tsx`
- [x] Подсказки — `Overlays.tsx`, `reader_hide_hints`
- [x] Окно настроек читалки — `SettingsModal.tsx`, `reader_settings`
- [x] Предзагрузка соседних страниц — 12 вперёд и 4 назад (`usePrefetchPages`)
- [x] Клавиатура на ПК (стрелки, пробел)
- [x] Запись прогресса в историю (`readHistory`: id, страница, всего, время)
- **Готово, когда:** все режимы переключаются, прогресс сохраняется и виден в истории.

## Этап 5. Локальная библиотека

- [x] **Закладки** — `app/favorites.tsx`, сортировка `ui.sort.favorites`
- [x] **История** — `app/history.tsx`, `BookListHistory.tsx`, `useFavHistory.ts`, `utils/book/timeAgo.ts`, сортировка
- [x] **Скачивание** — Rust `src-tauri/src/downloads.rs` (качает reqwest из `tauri-plugin-http`, перебирает зеркала и расширения, докачивает, отмена после текущей страницы, прогресс событием `nh-download`) + `src/lib/downloads.ts` (одна загрузка за раз, общее состояние). Раскладка как в 1.3.1: `NHAppAndroid/<id>_<название>/<язык>/Image001.… + metadata.json` (пишется в формате 1.3.1). На Android корень — `files` папки приложения, т.е. загрузки 1.3.1 после обновления видны сразу. Файлы отдаются через протокол asset (`protocol-asset`, папка добавляется в разрешения на лету, `asset:`/`http://asset.localhost` в CSP). Кнопка на книге: «Скачать» → кольцо с отменой → корзина с подтверждением. Полоса прогресса под шапкой и уведомления об итоге — `src/shell/DownloadBanner.tsx`. Не проверялось на устройствах
- [x] **Загруженное** — `DownloadedScreen` в `src/screens/LibraryScreens.tsx`: сортировка `ui.sort.downloaded`, качающаяся книга первой карточкой, перечитывание по окончании. Скачанная книга открывается на странице книги и в читалке с устройства, без сети
- [x] **Путь сохранения** — `SavePathRow` в настройках, только ПК: выбор папки через `tauri-plugin-dialog`, ключ `electron:savePath` как у старого ПК-клиента, по умолчанию `Pictures/NHAppSaves`
- **Готово, когда:** книга скачивается, открывается офлайн и удаляется.

## Этап 6. Аккаунт nhentai

- [x] **Вход/регистрация/сброс** — `src/shell/LoginModal.tsx`: PoW, капча. Вход паролем на устройстве ещё не проверялся
- [x] **Капча (Cloudflare Turnstile, нужна для входа, регистрации, сброса пароля и комментариев)** — `requestCaptcha` в `src/lib/session.ts`:
  - Android — `CaptchaDialog.kt`: WebView с базовым адресом nhentai.net, сторонние куки включены (как в react-native-webview), заголовок, «Отмена», при ошибке виджета — текст и «Повторить», по истечении токена виджет сбрасывается;
  - ПК — `src-tauri/src/captcha.rs` (команда `open_captcha`): окно на `https://nhentai.net/api/v2/captcha`, скрипт инициализации заменяет страницу виджетом, токен возвращается переходом на `nhentai.net/__nhapp_captcha#…`, который перехватывает Rust (замена `protocol.handle` из Electron);
  - команда `open_captcha` асинхронная: синхронная на Windows вешает приложение при создании окна;
  - в браузере при разработке недоступна. На ПК проверено — окно открывается и работает; на Android не проверялось
- [x] **Cloudflare-проверка** — не переносится: `CloudflareGate.tsx` в 1.3.1 нигде не подключён (остаток отправки комментариев через сайт `/api/gallery/{id}/comments/submit` с куками; её заменили API v2 + `CommentComposer`). Старый клиент API ответы Cloudflare тоже не обрабатывал. В новом запросы идут через Rust (`tauri-plugin-http`), куки WebView к ним не применяются. Признак `ApiError.isCloudflare` оставлен на случай, если API начнёт отвечать проверкой
- [x] **Сессия** — `src/lib/session.ts`: профиль в меню, выход. Полная очистка локальной библиотеки при выходе — вместе с облаком (этап 8), сейчас чистятся только онлайн-данные
- [x] **Онлайн-избранное** — `src/screens/FavoritesOnlineScreen.tsx`, `src/lib/onlineFavorites.ts`: поиск, пагинация, импорт из локальных, выбор и удаление с отменой, синк при старте, сердечко на странице книги. Фоновый авто-импорт — этап 10
- [x] **Профиль** — `src/screens/ProfileScreen.tsx` (баннер — размытый аватар вместо цвета)
- [x] **Редактирование профиля** — `src/screens/ProfileEditScreen.tsx` (`/profile/:id/:slug/edit`): аватар (выбор файла, обрезка по центру в квадрат), имя, email, «о себе», любимые теги, смена пароля (+ проверка совпадения паролей, в старом её не было). Кнопка «Сохранить» плавающая снизу вместо шапки. Сессий, ключей API и удаления аккаунта в старом интерфейсе нет — только функции в API, они перенесены в `src/api/account.ts`. На устройстве не проверялось
- [x] **Чёрный список с сервера** — правка внутри настроек профиля, как в старом (поиск по типу, добавление, удаление чипов); фильтрация каталога — `src/lib/blacklist.ts`
- [x] **Отправка комментариев** — `src/components/CommentComposer.tsx`: от 10 символов, капча → PoW `comment` → POST, новый комментарий сверху. Нажатие на автора открывает профиль. На устройстве не проверялось
- **Готово, когда:** вход работает на Android и ПК, избранное синхронизируется с сайтом.

## Этап 7. Теги и коллекции

- [x] Экран тегов — `src/screens/TagsScreen.tsx`: вкладки, поиск, строки, «Выбранные» (шторка / панель на планшете)
- [x] Избранные теги — `tag.favs.v1` (`src/lib/tagLibrary.ts`); недавние `tagRecents.v1` в релизе на экране не показывались
- [x] Коллекции тегов — `tagCollections.v1`: создание из выбранных, правка, удаление, применение
- [x] Справочник `api/nhentai-tags.json` → `src/data/nhentai-tags.json` (`scripts/build-tags-db.mjs`, 12,7 → 1,95 МБ, грузится только на экране тегов)
- **Готово, когда:** фильтр по коллекции тегов применяется к каталогу.

## Этап 8. Сервер nhapp (свой бэкенд)

Старое: `api/nhappApi/*`, `config/api.ts`, `.env` (адрес бэкенда).
- [x] HTTP-клиент к бэкенду, `syncUser`, `touchOnline` — `src/api/nappi.ts`; устройство — `src/lib/device.ts` (на Android ANDROID_ID и «производитель модель» из `SystemUi.kt`, те же значения, что у 1.3.1)
- [x] Домен бэкенда: новое приложение ходит на `https://nappi.moelibre.cc` (`src/config/api.ts`, можно переопределить `VITE_API_BASE_URL`), домен добавлен в CSP и `capabilities`. Старое приложение остаётся на `nappi.maks1mio.su` — оба домена ведут на один сервер
- [x] **Облачное хранилище и лобби** — `src/lib/cloudSync.ts`, подключение в `src/lib/session.ts`, значок облака в шапке — `src/shell/CloudButton.tsx`. Отличия от 1.3.1:
  - префикс `NHENTAI_`, который добавляет сервер, при приёме снимается (1.3.1 писал такие ключи как есть, и облачные данные до него не доходили);
  - закладки идут журналом `bookFavorites.ops.v1` — удаление не возвращается с другого устройства; локальный порядок закладок сохраняется;
  - отправка запускается любым изменением хранилища; после подключения сначала принимается снимок комнаты, потом отправляется свой;
  - при выходе библиотека стирается, только если в этой сессии она дошла до облака (в 1.3.1 — всегда);
  - тема и полноэкранный режим из облака применяются сразу.
  Слияние проверено на заглушках; на устройстве и с живым сервером не проверялось
- [ ] **Сервер не проверяет, чей `userId`** (сделать позже, когда 1.3.1 уйдёт из обращения). `/api/users/sync`, `/api/users/me/online`, `/api/users/me/storage` (GET/PUT) и WebSocket `/lobby` в `D:/Application/nappi` принимают любой id без токена: зная id (он виден в профиле nhentai), можно читать и перезаписывать чужое облако и войти в чужое лобби. Сейчас не включаем — 1.3.1 токен не шлёт, и у него синхронизация сломается. План:
  1. Новое приложение начинает слать токен nhentai: REST — `Authorization: User <token>`, лобби — параметр `token` (`src/api/nappi.ts`, `src/lib/cloudSync.ts`). Старый сервер лишнее игнорирует, так что это можно выпустить сразу.
  2. Сервер проверяет токен через `GET https://nhentai.net/api/v2/user` (id должен совпасть с заявленным), успешные проверки кешируются на несколько минут. Флаг в `.env`: сначала только лог, без отказа.
  3. Когда по логам запросов без токена почти не останется (1.3.1 обновились), включить отказ: 401/403, лобби закрывать с кодом 4001.
- [x] **Управление хранилищем** — `src/components/StorageManager.tsx` в настройках: ключи с размерами и поиском, правка/копирование/удаление, экспорт (Android — системное «Поделиться» через `NHAppNative.shareText`, файл во временной папке), импорт из файла и из буфера (`NHAppNative.clipboardText`), «Очистить всё». Галочка «Перезаписать существующие» теперь работает (в старом ни на что не влияла); «Очистить всё» сохраняет `legacyImport.v1` и `@cloud.deviceId`. `uikit/Graph.tsx` в старом использовался только на демо-странице UI-кита — не переносится. На устройстве не проверялось
- [ ] **Рекомендации** — `app/recommendations.tsx`, `recommendations.ts` (1139), `recommendationLib.ts`, калибровка популярности тегов
- [ ] **Персонажи** — `app/characters.tsx` (1558), `characterCards.ts`, `CharacterSelectModal`, `CharacterCropModal`, `EditCharacterCardModal`, `hooks/useCharacterCardsForPage.ts` (+ вывод карточек на странице книги)
- [ ] **Поиск по картинке** — `imsearchClient.ts`, `lib/imsearchPendingUpload.ts`, `api/kurosearch` (выбор файла → `plugin-dialog`)
- **Готово, когда:** данные синхронизируются между старым и новым приложением на одном аккаунте.

## Этап 9. Настройки целиком

Старое: `app/settings/index.tsx`, `components/settings/*` (схема → `SettingsBuilder`).
- [ ] Каркас: `schema.ts`, `SettingsBuilder.tsx`, `SettingsLayout.tsx`, `Section.tsx`, `Card.tsx`, строки `SwitchRow`, `SliderRow`, `LanguageRow`
- [ ] Язык — `LanguageSelector.tsx`
- [ ] Палитра — `HuePaletteSelector.tsx` (вместо голого ползунка)
- [ ] Бесконечная прокрутка, сброс тегов при переходе, полноэкранный режим
- [ ] Сетка — `GridSection.tsx`
- [ ] Путь сохранения, хранилище, автоимпорт
- **Готово, когда:** все пункты старых настроек на месте и влияют на приложение.

## Этап 10. Сервисное

- [ ] «Что нового» — `components/WhatsNewModal`, `app/whats-new.tsx`, `store/pendingWhatsNew.ts`
- [ ] Проверка обновлений — `hooks/useUpdateCheck.ts` (или `@tauri-apps/plugin-updater` для ПК)
- [ ] Автоимпорт — `lib/autoImport.ts`, `context/AutoImportProvider.tsx`, `background/autoImport.task.ts` (фоновая задача на Android — решить: при старте приложения или нативный воркер)
- [ ] Haptics, буфер обмена, «Поделиться» (`expo-haptics`, `expo-clipboard`, sharing)
- [ ] Проверка сети — `@react-native-community/netinfo` → `navigator.onLine`
- [ ] Экран 404 — `app/+not-found.tsx`

## Этап 11. Сборка для ПК (замена Electron)

- [ ] Окно, заголовок, размеры — вместо `electron/main.js`, `ElectronTitleBar.tsx`
- [ ] Отдельное окно читалки (если нужно) — `electron/reader.js`
- [x] Капча — окно `src-tauri/src/captcha.rs` вместо `ElectronWebviewTurnstile.tsx` (см. этап 6), проверено на ПК
- [ ] Установщик Windows через `tauri build`

## Не переносим

- Всё, что есть только в ветке `new-ui`: `uikit/BrowseFloatingBar.tsx`, `uikit/BrowseOptionsSheet.tsx`, `ExploreFilterMenuDropdown.tsx`, `constants/nhentaiStorageKeys.ts`, `lib/migrateNhentaiStorageKeys.ts`
- `components/BookCard/design/BookCardClassic.backup.tsx`, `electron/example-usage.tsx`, `InternalBytecode.js`
- Скрипты Gradle/Expo (`scripts/fixGradle.js`, `prepare-android.js`, `sync-android-overrides.js`, `overrides/`) — у Tauri своя сборка
- `api/auth.ts` (старые cookie csrftoken/sessionid) — если API v2 полностью покрывает вход
- `api/.venv` (Python-окружение)

---

## Как работать по плану

1. Берём первый неотмеченный пункт сверху.
2. Открываем указанные старые файлы, переносим логику и вёрстку (RN `View/Text/StyleSheet` → `div/span/CSS`).
3. Сверяем со старым приложением на телефоне бок о бок (скриншоты).
4. Отмечаем `[x]`, коммит, следующий пункт.
