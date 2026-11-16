import { useEffect, useState, type ReactNode } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { DesktopBrowser } from "./browser/DesktopBrowser";
import { IS_DESKTOP } from "./lib/platform";
import { Shell } from "./shell/Shell";
import { HomeScreen } from "./screens/HomeScreen";
import { CommunityScreen } from "./screens/CommunityScreen";
import { BookScreen } from "./screens/BookScreen";
import { ReaderScreen } from "./screens/ReaderScreen";
import { CommentsScreen } from "./screens/CommentsScreen";
import { DownloadedScreen, NoteScreen, SavedScreen } from "./screens/LibraryScreens";
import { SettingsScreen, SettingsSectionScreen } from "./screens/SettingsScreen";
import { TagsScreen } from "./screens/TagsScreen";
import { FavoritesOnlineScreen } from "./screens/FavoritesOnlineScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { ProfileEditScreen } from "./screens/ProfileEditScreen";
import { MeScreen } from "./screens/MeScreen";
import { MlSecurityScreen } from "./screens/MlSecurity";
import { MlCloudDataScreen, MlCloudDevicesScreen, MlCloudImportScreen, MlCloudManageScreen, MlCloudSetupScreen } from "./screens/MlCloud";
import { TabsScreen } from "./screens/TabsScreen";
import { NhAccountsScreen } from "./screens/NhAccountsScreen";
import { MlAccountScreen } from "./screens/MlAccountScreen";
import { I18nProvider } from "./i18n/I18nContext";
import { RecommendationsScreen } from "./screens/RecommendationsScreen";
import { CharactersScreen } from "./screens/CharactersScreen";
import { ImageSearchScreen } from "./screens/ImageSearchScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { UikitScreen } from "./screens/UikitScreen";
import { OverlayPortalProvider, ToastProvider } from "./ui";
import { importLegacyStorage } from "./lib/importLegacyStorage";
import { migrateLegacyKeys } from "./lib/migrateLegacyKeys";
import { KEYS, getItem, subscribe } from "./lib/storage";
import { applyFullscreen, restoreFullscreen } from "./shell/systemUi";
import { applyTheme, loadHue, setBaseHue, themeColors } from "./theme";

/** Экраны приложения. На ПК — в роутере каждой вкладки браузера, на телефоне — в одном роутере. */
const appRoutes = (
  <Routes>
    <Route path="/" element={<HomeScreen />} />
    <Route path="/explore" element={<HomeScreen />} />
    <Route path="/search" element={<SearchScreen />} />
    <Route path="/image-search" element={<ImageSearchScreen />} />
    <Route path="/tags" element={<TagsScreen />} />
    <Route path="/book/:id" element={<BookScreen />} />
    <Route path="/book/:id/comments" element={<CommentsScreen />} />
    <Route path="/read/:id" element={<ReaderScreen />} />
    <Route path="/favorites" element={<SavedScreen kind="favorites" />} />
    <Route path="/history" element={<SavedScreen kind="history" />} />
    <Route path="/settings" element={<SettingsScreen />} />
    <Route path="/settings/:section" element={<SettingsSectionScreen />} />
    <Route path="/uikit" element={<UikitScreen />} />
    <Route path="/downloaded" element={<DownloadedScreen />} />
    <Route path="/me" element={<MeScreen />} />
    <Route path="/mlid" element={<MlAccountScreen />} />
    <Route path="/accounts/nhentai" element={<NhAccountsScreen />} />
    <Route path="/tabs" element={<TabsScreen />} />
    <Route path="/accounts/nhentai/edit" element={<ProfileEditScreen />} />
    <Route path="/mlid/cloud/data" element={<MlCloudDataScreen />} />
    <Route path="/mlid/cloud/devices" element={<MlCloudDevicesScreen />} />
    <Route path="/mlid/cloud/setup" element={<MlCloudSetupScreen />} />
    <Route path="/mlid/security" element={<MlSecurityScreen />} />
    <Route path="/mlid/cloud/import" element={<MlCloudImportScreen />} />
    <Route path="/mlid/cloud/manage" element={<MlCloudManageScreen />} />
    <Route path="/favorites-online" element={<FavoritesOnlineScreen />} />
    <Route path="/profile/:id/:slug" element={<ProfileScreen />} />
    <Route path="/profile/:id/:slug/edit" element={<ProfileEditScreen />} />
    <Route path="/community" element={<CommunityScreen />} />
    <Route path="/characters" element={<CharactersScreen />} />
    <Route path="/recommendations" element={<RecommendationsScreen />} />
    <Route path="/login" element={<NoteScreen titleKey="menu.login" textKey="notes.login" />} />
    <Route path="*" element={<NoteScreen titleKey="notes.notFoundTitle" textKey="notes.notFoundText" />} />
  </Routes>
);

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
            {IS_DESKTOP ? (
              <DesktopBrowser routes={appRoutes} />
            ) : (
              <HashRouter>
                <Shell>{appRoutes}</Shell>
              </HashRouter>
            )}
          </OverlayPortalProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeBoot>
  );
}
