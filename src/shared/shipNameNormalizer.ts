/** 统一舰名别名、后端标准名和搜索名转换。 */
export function toBackendName(displayName: string): string {
  const noRefit = displayName.endsWith('·改')
    ? displayName.slice(0, -2)
    : displayName;
  return noRefit.replace(/\s*[（(][^（）()]*[)）]\s*$/, '').trim();
}

export function resolveConfiguredShipSearchName(
  name: string,
  aliases: Readonly<Record<string, string>>,
): string {
  const normalizedName = toBackendName(name);
  for (const [alias, standardName] of Object.entries(aliases)) {
    const normalizedAlias = alias.trim();
    if (
      normalizedAlias
      && toBackendName(standardName) === normalizedName
    ) {
      return normalizedAlias;
    }
  }
  return name.trim();
}
