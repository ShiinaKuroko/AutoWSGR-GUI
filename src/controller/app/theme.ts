/** 获取当前主题模式 */
export function getThemeMode(): 'dark' | 'light' | 'system' {
  const mode = localStorage.getItem('themeMode');
  return mode === 'dark' || mode === 'system' ? mode : 'light';
}

/** 获取当前主色调 */
export function getAccentColor(): string {
  const accent = localStorage.getItem('accentColor') || '#0f7dff';
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#0f7dff';
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** 将十六进制颜色转换为 RGB。 */
function hexToRgb(hex: string): RgbColor {
  const value = parseInt(hex.slice(1), 16);
  return {
    r: value >> 16,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** 将颜色按比例混入黑色或白色。 */
function tintColor(hex: string, target: 0 | 255, ratio: number): string {
  const rgb = hexToRgb(hex);
  const channel = (value: number) => Math.round(value + (target - value) * ratio);
  const value = (channel(rgb.r) << 16) | (channel(rgb.g) << 8) | channel(rgb.b);
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** 根据强调色亮度选择清晰的按钮文字颜色。 */
function getAccentForeground({ r, g, b }: RgbColor): string {
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#172033' : '#ffffff';
}

/** 根据主题模式 + 主色调更新 DOM */
export function applyTheme(): void {
  const mode = getThemeMode();
  let resolved: 'dark' | 'light';
  if (mode === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    resolved = mode;
  }
  document.documentElement.setAttribute('data-theme', resolved);

  const accent = getAccentColor();
  const rgb = hexToRgb(accent);
  const hover = tintColor(accent, resolved === 'light' ? 0 : 255, resolved === 'light' ? 0.14 : 0.16);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-hover', hover);
  document.documentElement.style.setProperty('--accent-foreground', getAccentForeground(rgb));
  document.documentElement.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolved === 'light' ? 0.2 : 0.18})`);
  document.documentElement.style.setProperty('--accent-subtle', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolved === 'light' ? 0.12 : 0.09})`);
}
