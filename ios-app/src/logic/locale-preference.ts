/** Keep the original per-computer record and verify writes (browser storage may be disabled). */
export async function saveLocalePreference(storage: {
  read: (scope: string, key: string) => Promise<Record<string, unknown> | null>;
  write: (scope: string, key: string, value: unknown) => Promise<void>;
}, serverId: string, locale: 'host' | 'system' | 'en' | 'zh') {
  const key = 'mobile-preferences';
  const previous = await storage.read(serverId, key);
  await storage.write(serverId, key, {...previous, locale});
  const saved = await storage.read(serverId, key);
  if (saved?.locale !== locale) throw Error('Language changed for this session, but could not be saved on this device.');
}
