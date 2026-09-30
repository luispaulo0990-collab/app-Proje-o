/**
 * TypeScript access to the design tokens defined in `styles/tokens.css` (single source).
 * - `colors.*` are CSS variable references for style props.
 * - `resolveColors()` returns concrete values for SVG/canvas libraries (charts) that cannot
 *   read CSS variables in presentation attributes.
 */
const TOKENS = {
  primary: 'color-primary',
  primarySoft: 'color-primary-soft',
  secondary: 'color-secondary',
  background: 'color-background',
  surface: 'color-surface',
  border: 'color-border',
  text: 'color-text',
  textMuted: 'color-text-muted',
  success: 'color-success',
  warning: 'color-warning',
  error: 'color-error',
  info: 'color-info',
  grid: 'color-ink-200',
} as const;

type ColorName = keyof typeof TOKENS;

export const colors = Object.fromEntries(
  Object.entries(TOKENS).map(([k, v]) => [k, `var(--${v})`]),
) as Record<ColorName, string>;

export function resolveColors(): Record<ColorName, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(TOKENS).map(([k, v]) => [
      k,
      style.getPropertyValue(`--${v}`).trim() || 'currentColor',
    ]),
  ) as Record<ColorName, string>;
}

export const typography = {
  sans: 'var(--font-sans)',
  display: 'var(--font-display)',
} as const;
