import type { Bot } from "../types";

export type MyLook = { color?: string; avatar?: Bot["avatar"] };
export type MyLookState = {
  look: MyLook;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: "load" | "save" | null;
};

function copyLook(value: MyLook): MyLook {
  return Object.freeze({ ...value, ...(value.avatar ? { avatar: Object.freeze({ ...value.avatar }) } : {}) });
}

/** One phone-local owner serializes saves; it has no host or network dependency. */
export function createMyLookStore({ read, write }: {
  read: () => Promise<MyLook | null>;
  write: (value: MyLook) => Promise<boolean | void>;
}) {
  let state: MyLookState = { look: copyLook({}), loaded: false, loading: false, saving: false, dirty: false, error: null };
  const listeners = new Set<() => void>();
  let saved = copyLook({}), revision = 0, savedRevision = 0, replacedBeforeLoad = false;
  let loadFlight: Promise<boolean> | null = null, saveFlight: Promise<boolean> | null = null;
  const publish = (patch: Partial<MyLookState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  function load(): Promise<boolean> {
    if (state.loaded) return Promise.resolve(true);
    if (loadFlight) return loadFlight;
    publish({ loading: true, error: null });
    loadFlight = (async () => {
      try {
        const value = await read();
        saved = copyLook(value && typeof value === "object" && !Array.isArray(value) ? value : {});
        // Merge only the still-untouched fields. A reset is a complete replacement.
        const look = revision === 0 ? saved : copyLook({ ...(replacedBeforeLoad ? {} : saved), ...state.look });
        publish({ look, loaded: true, loading: false, dirty: revision !== savedRevision, error: null });
        return true;
      } catch {
        // Do not overwrite unread local data with a partial edit after a failed read.
        publish({ loading: false, error: "load" });
        return false;
      }
    })().finally(() => { loadFlight = null; });
    return loadFlight;
  }
  function persist(): Promise<boolean> {
    if (saveFlight) return saveFlight;
    let completedRevision = revision;
    publish({ saving: true, error: null });
    saveFlight = (async () => {
      if (!await load()) { completedRevision = revision; publish({ saving: false }); return false; }
      while (savedRevision !== revision) {
        const issued = revision, value = copyLook(state.look);
        let succeeded = false;
        try { succeeded = await write(value) !== false; } catch { /* Keep the error category, never storage details. */ }
        if (!succeeded) {
          if (issued !== revision) continue; // A later explicit edit can still be saved.
          completedRevision = issued;
          publish({ saving: false, dirty: true, error: "save" });
          return false;
        }
        saved = value;
        savedRevision = issued;
        publish({ dirty: savedRevision !== revision, error: null });
      }
      completedRevision = revision;
      publish({ saving: false, dirty: false, error: null });
      return true;
    })().then((result) => {
      saveFlight = null;
      // An edit may join this flight after its loop finishes but before this
      // microtask releases it. Carry that edit (and its result) into a new save.
      // The same failed revision waits for an explicit retry.
      return completedRevision !== revision ? persist() : result;
    });
    return saveFlight;
  }
  const edit = (value: MyLook, replace: boolean) => {
    revision++;
    if (!state.loaded && replace) replacedBeforeLoad = true;
    publish({ look: copyLook(replace ? value : { ...state.look, ...value }), dirty: true, error: null });
    return persist();
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    update: (patch: MyLook) => edit(patch, false),
    reset: () => edit({}, true),
    retry: persist,
    restore() {
      if (!state.loaded || state.saving) return Promise.resolve(false);
      return edit(saved, true);
    },
  };
}
