import type {SavedHost} from './hosts.ts';

export type ComputerNameSnapshot = Readonly<Record<string, string | null>>;
const key = 'computer-name';
export function normalizeComputerName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('Enter a computer name.');
  const name = value.trim();
  if (Array.from(name).length > 40 || /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(name)) throw Error('Use up to 40 characters on one line.');
  return name;
}
export function computerName(host: Pick<SavedHost, 'serverId' | 'name'> | null | undefined, names: ComputerNameSnapshot): string {
  const local = host && Object.prototype.hasOwnProperty.call(names, host.serverId) ? names[host.serverId] : null;
  return typeof local === 'string' ? local : host?.name?.trim() || 'DeepSeek Bot Pro';
}

/** Display-only records: connection, credential, language and desktop data are never written. */
export function createComputerNameStore(storage: {
  read: (serverId: string, key: string) => Promise<unknown>;
  write: (serverId: string, key: string, value: unknown) => Promise<void>;
}) {
  let snapshot: ComputerNameSnapshot = Object.freeze({});
  let writes = Promise.resolve();
  const loads = new Map<string, Promise<void>>();
  const removals = new Set<string>();
  const generations = new Map<string, number>();
  const resets = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const publish = (id: string, name: string | null) => {
    if (Object.prototype.hasOwnProperty.call(snapshot, id) && snapshot[id] === name) return;
    snapshot = Object.freeze({...snapshot, [id]: name});
    for (const listener of listeners) listener();
  };
  function hydrate(id: string): Promise<void> {
    const previous = loads.get(id);
    if (previous) return previous;
    const pending = storage.read(id, key).then(value => {
      if (!removals.has(id)) publish(id, value == null ? null : normalizeComputerName(value));
    }).catch(() => { loads.delete(id); throw Error('Could not read saved computer names. Try again.'); });
    loads.set(id, pending);
    return pending;
  }
  function write(id: string, name: string | null, reset = false): Promise<void> {
    const generation = generations.get(id) ?? 0;
    const operation = writes.then(async () => {
      if (reset && (!removals.has(id) || generation !== (generations.get(id) ?? 0))) return;
      await hydrate(id);
      try {
        await storage.write(id, key, name);
        const saved = await storage.read(id, key);
        if (saved !== name) throw Error('Name readback differs.');
      } catch {
        loads.delete(id);
        throw Error('Could not confirm the computer name was saved. Please try again.');
      }
      if (generation === (generations.get(id) ?? 0)) {
        removals.delete(id);
        publish(id, name);
      }
    });
    writes = operation.catch(() => {});
    return operation;
  }
  function reset(id: string): Promise<void> {
    const previous = resets.get(id);
    if (previous) return previous;
    const operation = write(id, null, true).finally(() => { if (resets.get(id) === operation) resets.delete(id); });
    resets.set(id, operation);
    return operation;
  }
  function load(id: string): Promise<void> { return removals.has(id) ? reset(id) : hydrate(id); }
  async function rename(id: string, value: string | null): Promise<void> {
    if (!id) throw Error('Computer is no longer saved.');
    const name = value === null ? null : normalizeComputerName(value);
    await write(id, name);
  }
  function forget(id: string): Promise<void> {
    if (!removals.has(id)) generations.set(id, (generations.get(id) ?? 0) + 1);
    removals.add(id);
    publish(id, null);
    return reset(id);
  }
  return {load, rename, forget, getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }};
}
