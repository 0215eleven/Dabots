// The paired-device list on the Mobile devices page: this phone apart from the
// rest, the rest by most recent use, and enough detail to tell same-named
// devices (a phone paired again shows up twice as "My iPhone") apart.
export interface PairedDevice {
  id: string;
  name?: string;
  deviceName?: string;
  createdAt?: unknown;
  lastSeenAt?: unknown;
  revokedAt?: unknown;
}

const time = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
export const lastActive = (device: PairedDevice) => time(device.lastSeenAt) || time(device.createdAt);

export function groupDevices<T extends PairedDevice>(devices: T[], currentId: string) {
  const live = devices.filter(device => !device.revokedAt);
  const current = live.find(device => device.id === currentId) || null;
  const others = live.filter(device => device !== current).sort((a, b) => lastActive(b) - lastActive(a));
  return { current, others };
}

/** Not used for this long: most likely an old pairing of a phone that was paired again. */
export const STALE_AFTER = 30 * 24 * 60 * 60 * 1000;
export const isStale = (device: PairedDevice, now: number) => {
  const seen = lastActive(device);
  return !!seen && now - seen > STALE_AFTER;
};

/** A day-level "when" as a translation key and its parameters. */
export function relativeDay(value: unknown, now: number): [string, Record<string, string | number>?] | null {
  const at = time(value);
  if (!at) return null;
  const day = (ms: number) => { const date = new Date(ms); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return ["today"];
  if (days === 1) return ["yesterday"];
  if (days < 30) return ["{count} days ago", { count: days }];
  const date = new Date(at);
  return ["{year}-{month}-{day}", { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }];
}
