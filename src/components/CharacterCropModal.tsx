/**
 * Выбор рамки на странице — перенос `components/CharacterCropModal.tsx`: рамка постоянных пропорций 1,4 : 2,
 * двигается пальцем или мышью, размер меняется кнопками и колёсиком. Результат — доли размера страницы.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CardRect } from "../api/characterCards";
import { pageSources } from "../api/media";
import { useI18n } from "../i18n/I18nContext";
import { Button, Icon, NhModal } from "../ui";

/** Высота рамки к её ширине, в пикселях страницы. */
const ASPECT = 2 / 1.4;
const MIN_WIDTH = 0.12;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

interface Frame {
  x: number;
  y: number;
  width: number;
}

export function CharacterCropModal({
  visible,
  imageUrl,
  initial,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  imageUrl: string;
  initial?: CardRect | null;
  onCancel: () => void;
  onConfirm: (rect: CardRect) => void;
}) {
  const { t } = useI18n();
  const sources = pageSources(imageUrl);
  const [source, setSource] = useState(0);
  /** Высота страницы к ширине. */
  const [ratio, setRatio] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSource(0);
    setRatio(0);
    setFrame(null);
  }, [visible, imageUrl]);

  /** Высота рамки в долях высоты страницы. */
  const heightOf = (width: number) => (width * ASPECT) / ratio;
  const maxWidth = () => Math.min(1, ratio / ASPECT);

  const fit = (f: Frame): Frame => {
    const width = clamp(f.width, Math.min(MIN_WIDTH, maxWidth()), maxWidth());
    return { width, x: clamp(f.x, 0, 1 - width), y: clamp(f.y, 0, 1 - heightOf(width)) };
  };

  // Рамка ставится, когда стали известны размеры страницы
  useEffect(() => {
    if (!ratio || frame) return;
    if (initial && initial.width > 0) setFrame(fit({ x: initial.x, y: initial.y, width: initial.width }));
    else {
      const width = Math.min(maxWidth() * 0.6, 0.9);
      setFrame(fit({ x: (1 - width) / 2, y: (1 - heightOf(width)) / 2, width }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, frame, initial]);

  const resize = (factor: number) => {
    if (!frame) return;
    const width = clamp(frame.width * factor, Math.min(MIN_WIDTH, maxWidth()), maxWidth());
    // Центр рамки остаётся на месте
    setFrame(fit({ width, x: frame.x + (frame.width - width) / 2, y: frame.y + (heightOf(frame.width) - heightOf(width)) / 2 }));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!frame) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: frame.x, y: frame.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (!drag.current || !frame || !box) return;
    const { px, py, x, y } = drag.current;
    setFrame(fit({ width: frame.width, x: x + (e.clientX - px) / box.width, y: y + (e.clientY - py) / box.height }));
  };

  const confirm = () => {
    if (!frame) return;
    onConfirm({ x: frame.x, y: frame.y, width: frame.width, height: heightOf(frame.width) });
  };

  return (
    <NhModal visible={visible} onClose={onCancel} title={t("crop.title")} heightPercent={0.92} sizing="fixed">
      <div className="ch-crop">
        <div className="ch-crop-area" onWheel={(e) => resize(e.deltaY < 0 ? 1.08 : 0.92)}>
          <div ref={stage} className="ch-crop-stage">
            <img
              src={sources[source]}
              alt=""
              draggable={false}
              onLoad={(e) => setRatio(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
              onError={() => setSource((i) => Math.min(i + 1, sources.length - 1))}
            />
            {frame && (
              <div
                className="ch-crop-frame"
                style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.width * 100}%`, height: `${heightOf(frame.width) * 100}%` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
              />
            )}
          </div>
        </div>
        <div className="ch-crop-actions">
          <button type="button" className="ax-icon-btn" aria-label="−" onClick={() => resize(0.88)}>
            <Icon name="minus" size={20} />
          </button>
          <button type="button" className="ax-icon-btn" aria-label="+" onClick={() => resize(1.12)}>
            <Icon name="plus" size={20} />
          </button>
          <span className="ch-spacer" />
          <Button title={t("crop.cancel")} variant="secondary" compact onPress={onCancel} />
          <Button title={t("crop.accept")} compact disabled={!frame} onPress={confirm} />
        </div>
      </div>
    </NhModal>
  );
}
