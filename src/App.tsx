import { useEffect, useState, type ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./shell/Shell";
import { HomeScreen } from "./screens/HomeScreen";
import { BookScreen } from "./screens/BookScreen";
import { ReaderScreen } from "./screens/ReaderScreen";
import { CommentsScreen } from "./screens/CommentsScreen";
import { DownloadedScreen, NoteScreen, SavedScreen } from "./screens/LibraryScreens";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TagsScreen } from "./screens/TagsScreen";
import { FavoritesOnlineScreen } from "./screens/FavoritesOnlineScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ProfileEditScreen } from "./screens/ProfileEditScreen";
import { MeScreen } from "./screens/MeScreen";
import { I18nProvider } from "./i18n/I18nContext";
import { SearchScreen } from "./screens/SearchScreen";
import { UikitScreen } from "./screens/UikitScreen";
import { OverlayPortalProvider, ToastProvider } from "./ui";
import { importLegacyStorage } from "./lib/importLegacyStorage";
import { migrateLegacyKeys } from "./lib/migrateLegacyKeys";
import { KEYS, getItem, subscribe } from "./lib/storage";
import { applyFullscreen, restoreFullscreen } from "./shell/systemUi";
import { applyTheme, loadHue, setBaseHue, themeColors } from "./theme";

function ThemeBoot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    importLegacyStorage();
    migrateLegacyKeys();
    restoreFullscreen();
    setBaseHue(loadHue());
    applyTheme(themeColors());
    setReady(true);
    // Тема и полноэкранный режим могут прийти из облака — применяем сразу
    return subscribe((key) => {
      if (key === KEYS.themeHue) {
        setBaseHue(loadHue());
        applyTheme(themeColors());
      } else if (key === KEYS.fullscreen) {
        applyFullscreen(getItem(KEYS.fullscreen) === "true");
      }
    });
  }, []);
  if (!ready) return null;
  return children;
}

export default function App() {
  return (
    <ThemeBoot>
      <I18nProvider>
        <ToastProvider>
          <OverlayPortalProvider>
            <HashRouter>
              <Shell>
                <Routes>
                  <Route path="/" element={<HomeScreen />} />
                  <Route path="/explore" element={<HomeScreen />} />
                  <Route path="/search" element={<SearchScreen />} />
                  <Route path="/tags" element={<TagsScreen />} />
                  <Route path="/book/:id" element={<BookScreen />} />
                  <Route path="/book/:id/comments" element={<CommentsScreen />} />
                  <Route path="/read/:id" element={<ReaderScreen />} />
                  <Route path="/favorites" element={<SavedScreen kind="favorites" />} />
                  <Route path="/history" element={<SavedScreen kind="history" />} />
                  <Route path="/settings" element={<SettingsScreen />} />
                  <Route path="/uikit" element={<UikitScreen />} />
                  <Route path="/downloaded" element={<DownloadedScreen />} />
                  <Route path="/me" element={<MeScreen />} />
                  <Route path="/favorites-online" element={<FavoritesOnlineScreen />} />
                  <Route path="/profile/:id/:slug" element={<ProfileScreen />} />
                  <Route path="/profile/:id/:slug/edit" element={<ProfileEditScreen />} />
                  <Route
                    path="/characters"
                    element={<NoteScreen titleKey="menu.characters" textKey="notes.characters" />}
                  />
                  <Route
                    path="/recommendations"
                    element={<NoteScreen titleKey="menu.recommendations" textKey="notes.recommendations" />}
                  />
                  <Route path="/login" element={<NoteScreen titleKey="menu.login" textKey="notes.login" />} />
                  <Route path="*" element={<NoteScreen titleKey="notes.notFoundTitle" textKey="notes.notFoundText" />} />
                </Routes>
              </Shell>
            </HashRouter>
          </OverlayPortalProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeBoot>
  );
}
