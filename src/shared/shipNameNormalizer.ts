/** 统一舰名别名、后端标准名和搜索名转换。 */
export function toBackendName(displayName: string): string {
  const noRefit = displayName.endsWith('·改')
    ? displayName.slice(0, -2)
    : displayName;
  return noRefit.replace(/\s*[（(][^（）()]*[)）]\s*$/, '').trim();
}
