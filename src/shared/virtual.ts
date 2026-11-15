import { useEffect, useState } from "react";

export type VisibleRange = { start: number; end: number };

/**
 * 固定行高的可见区间计算。编排轨与混音通道条共用同一套数学：
 * 只渲染视口内（外加少量 overscan）的行，滚出屏幕的轨道仍然存在于
 * 模型与调度器中，只是不产生 DOM 节点。
 */
export function visibleRange(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 2,
): VisibleRange {
  if (count <= 0) return { start: 0, end: 0 };
  const height = rowHeight > 0 ? rowHeight : 1;
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
  const view = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
  const first = Math.floor(top / height);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + Math.ceil(view / height) + 1 + overscan);
  return { start: Math.max(0, Math.min(start, count)), end: Math.max(0, end) };
}

/** 按轨道 id 找到真实索引；绝不使用可见行号代替 id。 */
export function indexOfTrack(
  tracks: readonly { id: string }[],
  id: string | null,
) {
  if (!id) return -1;
  return tracks.findIndex((track) => track.id === id);
}

/**
 * 固定行高容器的可见区间。滚动只做数学计算，不触发重排或音频节点重建；
 * 回调里也不应做音频工作——调度由工作室的定时器统一负责。
 */
export function useVisibleRows(
  ref: React.RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan: number = 2,
): VisibleRange {
  const [metrics, setMetrics] = useState({ scrollTop: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const read = () => {
      const scrollTop = node.scrollTop;
      const height = node.clientHeight;
      setMetrics((prev) =>
        prev.scrollTop === scrollTop && prev.height === height
          ? prev
          : { scrollTop, height },
      );
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        read();
      });
    };
    read();
    node.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [ref]);
  return visibleRange(
    count,
    metrics.scrollTop,
    metrics.height,
    rowHeight,
    overscan,
  );
}
