/**
 * Каркас приложения — перенос AppShell / AppContent из старого `app/_layout.tsx`.
 * Меню шириной 300px лежит под содержимым, при открытии содержимое уезжает вправо
 * (drawerType="back"). На планшете в альбомной ориентации меню закреплено слева.
 * Сверху — полоса под статус-бар цвета шапки, затем шапка (кроме читалки и поиска).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAndroidBack, useBackHandler } from "./androidBack";
import { DownloadBanner, DownloadNotifier } from "./DownloadBanner";
import { SideMenu } from "./SideMenu";
import { TopBar } from "./TopBar";

function usePermanentDrawer(): boolean {
  const query = "(min-width: 600px) and (min-height: 600px) and (orientation: landscape)";
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const apply = () => setMatch(media.matches);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return match;
}

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const permanent = usePermanentDrawer();
  const reader = pathname.startsWith("/read/");
  const search = pathname.startsWith("/search");
  const drawerOpen = open && !permanent;

  useEffect(() => setOpen(false), [pathname]);
  useBackHandler(drawerOpen, () => setOpen(false));
  useAndroidBack(() => false);

  if (reader)
    return (
      <div className="app app-reader">
        <DownloadNotifier />
        {children}
      </div>
    );

  return (
    <div className={`app${permanent ? " app-permanent" : ""}${drawerOpen ? " drawer-open" : ""}`}>
      <aside className="drawer" aria-hidden={!permanent && !open}>
        <SideMenu onClose={() => setOpen(false)} />
      </aside>
      <div className="main">
        <div className="top-chrome" />
        {!search && <TopBar onOpenMenu={() => setOpen(true)} />}
        <DownloadBanner />
        <DownloadNotifier />
        <div className="content">{children}</div>
        {drawerOpen && <button type="button" className="drawer-scrim" aria-label="Close" onClick={() => setOpen(false)} />}
      </div>
    </div>
  );
}
