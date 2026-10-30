/**
 * Один слой поверх всего приложения — перенос `components/OverlayPortal.tsx`:
 * `show(node)` кладёт элемент поверх экрана, `hide()` убирает.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface OverlayCtx {
  show: (node: ReactNode) => void;
  hide: () => void;
}

const Ctx = createContext<OverlayCtx>({ show: () => {}, hide: () => {} });

export function OverlayPortalProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<ReactNode | null>(null);
  const value = useMemo(() => ({ show: setNode, hide: () => setNode(null) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {node ? <div className="ui-overlay-layer">{node}</div> : null}
    </Ctx.Provider>
  );
}

export const useOverlayPortal = () => useContext(Ctx);
