// The small logo shown by --help and --version, and nowhere else: three bars of growing height,
// like a token meter filling up (green, amber, red). It needs a terminal with color and room.

const GREEN = '\u001b[32m';
const AMBER = '\u001b[33m';
const RED = '\u001b[31m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

export interface LogoContext {
  /** Standard output is a terminal. */
  isTTY: boolean;
  /** Colors are on (not --no-color, NO_COLOR, --json, ...). */
  color: boolean;
  env: Record<string, string | undefined>;
  /** Terminal width in columns; unknown means no logo. */
  columns: number | undefined;
  /** An output mode that must stay machine-friendly: --json, --quiet or --markdown. */
  plain: boolean;
}

/** Narrowest terminal the logo is drawn in. */
export const LOGO_MIN_COLUMNS = 40;

export function shouldShowLogo(ctx: LogoContext): boolean {
  if (!ctx.isTTY || !ctx.color || ctx.plain) return false;
  if (ctx.env.NO_COLOR !== undefined || ctx.env.CI !== undefined) return false;
  if (ctx.env.TERM === 'dumb') return false;
  return ctx.columns !== undefined && ctx.columns >= LOGO_MIN_COLUMNS;
}

/** The three-line logo with the name and version on the last line. */
export function renderLogo(version: string): string {
  const bar = (color: string) => `${color}██${RESET}`;
  return [
    `      ${bar(RED)}`,
    `   ${bar(AMBER)} ${bar(RED)}`,
    `${bar(GREEN)} ${bar(AMBER)} ${bar(RED)}  ${BOLD}ctxsize${RESET} v${version}`,
    '',
  ].join('\n');
}
