/** One selection transaction across every switch, pairing and removal entry point. */
export function createHostTransitions(onPending: (pending: boolean) => void) {
  let revision = 0, active = true;
  let flight: { key: string | null; result: Promise<unknown> } | null = null;
  const cancelled = () => { throw new Error('The computer change was cancelled. Try again.'); };
  function begin<T>(key: string | null, stopped: () => T, run: (current: () => boolean) => Promise<T>): Promise<T> {
    const issued = revision;
    const current = () => active && issued === revision;
    const result = Promise.resolve().then(() => current() ? run(current) : stopped()).finally(() => {
      if (flight?.result === result) flight = null;
      if (active) onPending(false);
    });
    flight = { key, result };
    onPending(true);
    return result;
  }
  return {
    switchTo(key: string, run: (current: () => boolean) => Promise<boolean>) {
      if (!active) return Promise.resolve(false);
      if (flight) return flight.key === key ? flight.result as Promise<boolean> : Promise.resolve(false);
      return begin(key, () => false, run);
    },
    /** Refuse overlap before touching credentials or storage; never unpair a moving target. */
    mutate<T>(run: (current: () => boolean) => Promise<T>) {
      if (!active) return Promise.reject(new Error('The computer change was cancelled. Try again.'));
      if (flight) return Promise.reject(new Error('A computer change is already in progress. Try again.'));
      return begin<T>(null, cancelled, run);
    },
    setActive(value: boolean) {
      active = value;
      if (!value) revision++;
      else onPending(Boolean(flight));
    },
  };
}
