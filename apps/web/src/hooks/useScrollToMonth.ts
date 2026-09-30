import { useLayoutEffect, useRef } from 'react';

/**
 * Horizontal grids start years before today: scroll so the reference month is visible,
 * with `before` months of context to its left, right after the frozen columns.
 * Header cells must carry `data-month`; frozen header cells, `data-frozen`.
 */
export function useScrollToMonth<T extends HTMLElement>(month: string | undefined, before = 2) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (ref.current && month) scrollToMonth(ref.current, month, before);
  }, [month, before]);
  return ref;
}

/** Imperative version (e.g. an "Ir para o mês" button). */
export function scrollToMonth(
  el: HTMLElement,
  month: string,
  before = 2,
  behavior: ScrollBehavior = 'auto',
): void {
  const target = el.querySelector<HTMLElement>(`[data-month="${month}"]`);
  if (!target) return;
  const frozen = [...el.querySelectorAll<HTMLElement>('[data-frozen]')].reduce(
    (sum, c) => sum + c.offsetWidth,
    0,
  );
  el.scrollTo({
    left: Math.max(0, target.offsetLeft - frozen - before * target.offsetWidth),
    behavior,
  });
}
