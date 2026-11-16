/**
 * Права аккаунта nhentai этой вкладки в сообществе MoeLibre: модератор ли, забанен ли, подтверждён ли.
 * Перепроверяются при возвращении в приложение. Последний ответ помним по аккаунту — экраны (настройки,
 * сообщество) не мигают, пока идёт проверка.
 */
import { useEffect, useState } from "react";
import { getCommunityMe, type CommunityMe } from "../api/community";
import { useMe } from "./session";

export const NO_RIGHTS: CommunityMe = { isModerator: false, banned: false, verified: false };
const known = new Map<number, CommunityMe>();

export function useCommunityMe(): CommunityMe {
  const me = useMe();
  const [info, setInfo] = useState<CommunityMe>(() => (me && known.get(me.id)) || NO_RIGHTS);
  useEffect(() => {
    if (!me) {
      setInfo(NO_RIGHTS);
      return;
    }
    setInfo(known.get(me.id) ?? NO_RIGHTS);
    let alive = true;
    const check = () =>
      void getCommunityMe(me.id).then((x) => {
        known.set(me.id, x);
        if (alive) setInfo(x);
      });
    const onVisible = () => document.visibilityState === "visible" && check();
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me]);
  return info;
}
