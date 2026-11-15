import { describe, expect, it } from "vitest";
import { visibleRange } from "../virtual";

describe("虚拟滚动区间", () => {
  it("视口只覆盖少数行时不会渲染全部 64 轨", () => {
    const range = visibleRange(64, 0, 300, 75, 2);
    expect(range.start).toBe(0);
    expect(range.end).toBeLessThan(64);
    expect(range.end - range.start).toBeLessThanOrEqual(9);
  });

  it("滚到底部只渲染末尾行，不越界", () => {
    const range = visibleRange(64, 64 * 75 - 300, 300, 75, 2);
    expect(range.end).toBe(64);
    expect(range.start).toBeGreaterThan(0);
  });

  it("空作品和无效尺寸都返回安全值", () => {
    expect(visibleRange(0, 100, 300, 75)).toEqual({ start: 0, end: 0 });
    const range = visibleRange(10, NaN, NaN, 75);
    expect(range.start).toBe(0);
    expect(range.end).toBeGreaterThan(0);
  });

  it("反复滚动不改变行数，只改变窗口", () => {
    for (let i = 0; i < 500; i++) {
      const range = visibleRange(64, (i * 37) % 4000, 300, 75, 2);
      expect(range.end).toBeLessThanOrEqual(64);
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeGreaterThan(range.start);
    }
  });
});
