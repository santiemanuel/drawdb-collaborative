import { useEffect, useRef, useState } from "react";
import { clampTableWidth } from "../../utils/utils";
import { useSettings } from "../../hooks";

const handleRadius = 6;
const handleHitWidth = handleRadius * 2 + 2;
const handleInset = 6;

export default function ResizeHandles({
  x,
  y,
  width,
  height,
  visible,
  onResize,
  onResizeEnd,
  onEngagedChange,
  beforeResize,
  afterResize,
}) {
  const { settings } = useSettings();
  const [active, setActive] = useState(null);
  const [hovered, setHovered] = useState(null);
  const latestRef = useRef(null);
  const detachRef = useRef(null);
  const cancelRef = useRef(null);
  latestRef.current = {
    x,
    width,
    onResize,
    onResizeEnd,
    onEngagedChange,
    afterResize,
  };

  const engaged = hovered !== null || active !== null;

  useEffect(() => {
    latestRef.current.onEngagedChange?.(engaged);
  }, [engaged]);

  useEffect(() => {
    const cancel = () => cancelRef.current?.();
    window.addEventListener("drawdb:cancel-interaction", cancel);
    return () => {
      window.removeEventListener("drawdb:cancel-interaction", cancel);
      detachRef.current?.();
    };
  }, []);

  const beginResize = (side) => async (e) => {
    if (!e.isPrimary || detachRef.current) return;
    e.stopPropagation();

    const from = {
      x,
      width,
      clientX: e.clientX,
      pointerId: e.pointerId,
      zoom: e.currentTarget.ownerSVGElement?.getScreenCTM()?.a || 1,
    };
    let cancelled = false;
    const cancelPending = (event) => {
      if (event && event.pointerId !== from.pointerId) return;
      cancelled = true;
    };
    window.addEventListener("pointerup", cancelPending);
    window.addEventListener("pointercancel", cancelPending);
    detachRef.current = () => {
      cancelled = true;
      window.removeEventListener("pointerup", cancelPending);
      window.removeEventListener("pointercancel", cancelPending);
    };
    cancelRef.current = () => detachRef.current?.();
    let allowed = false;
    try {
      allowed = beforeResize ? await beforeResize() : true;
    } finally {
      window.removeEventListener("pointerup", cancelPending);
      window.removeEventListener("pointercancel", cancelPending);
      detachRef.current = null;
      cancelRef.current = null;
    }
    if (!allowed) return;
    if (cancelled) {
      latestRef.current.afterResize?.();
      return;
    }
    setActive(side);

    const move = (event) => {
      if (event.pointerId !== from.pointerId) return;

      const latest = latestRef.current;
      const delta = (event.clientX - from.clientX) / from.zoom;
      const next = clampTableWidth(
        side === "left" ? from.width - delta : from.width + delta,
      );
      if (next === latest.width) return;

      latest.onResize(
        side === "left"
          ? { width: next, x: from.x + from.width - next }
          : { width: next },
      );
    };

    const stop = (event, cancelled = false) => {
      if (event && event.pointerId !== from.pointerId) return;

      const latest = latestRef.current;
      if (cancelled) latest.onResize({ x: from.x, width: from.width });
      detachRef.current?.();
      detachRef.current = null;
      cancelRef.current = null;
      setActive(null);
      if (cancelled) {
        setHovered(null);
        return;
      }

      if (from.width === latest.width && from.x === latest.x) return;
      latest.onResizeEnd(
        { x: from.x, width: from.width },
        { x: latest.x, width: latest.width },
      );
    };

    const cancel = (event) => stop(event, true);
    cancelRef.current = () => cancel();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", cancel);
    detachRef.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", cancel);
      latestRef.current.afterResize?.();
    };
  };

  const handle = (side) => {
    const edgeX = side === "left" ? x : x + width;
    const barHeight = Math.max(0, height - handleInset * 2);
    return (
      <g key={side}>
        {(visible || engaged) && (
          <circle
            cx={edgeX}
            cy={y + height / 2}
            r={handleRadius}
            fill={settings.mode === "light" ? "white" : "rgb(28, 31, 35)"}
            stroke="#5891db"
            strokeWidth={2}
            className="pointer-events-none"
          />
        )}
        <rect
          x={edgeX - handleHitWidth / 2}
          y={y + handleInset}
          width={handleHitWidth}
          height={barHeight}
          fill="transparent"
          style={{ cursor: "ew-resize", touchAction: "none" }}
          onPointerEnter={(e) => e.isPrimary && setHovered(side)}
          onPointerLeave={(e) => e.isPrimary && setHovered(null)}
          onPointerDown={beginResize(side)}
        />
      </g>
    );
  };

  return (
    <>
      {handle("left")}
      {handle("right")}
    </>
  );
}
