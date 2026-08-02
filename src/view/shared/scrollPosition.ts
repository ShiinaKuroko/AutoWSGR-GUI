export interface ElementScrollPosition {
  top: number;
  left: number;
}

export function captureScrollPosition(
  element: HTMLElement | null,
): ElementScrollPosition {
  return {
    top: element?.scrollTop ?? 0,
    left: element?.scrollLeft ?? 0,
  };
}

export function restoreScrollPosition(
  element: HTMLElement | null,
  position: ElementScrollPosition,
): void {
  if (!element) return;
  element.scrollTop = position.top;
  element.scrollLeft = position.left;
  requestAnimationFrame(() => {
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
  });
}
