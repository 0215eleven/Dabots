import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readCache, writeCache } from '../storage';

export type HomeView = 'list' | 'office' | 'agent';
const VIEWS: readonly HomeView[] = ['list', 'office', 'agent'];
let current: HomeView = 'list', loaded = false;
const listeners = new Set<() => void>();
const set = (value: HomeView) => { current = value; for (const listener of listeners) listener(); };

/** The home's chat list, office or DSH Agent view, remembered on this phone and shared by every screen. */
export function useHomeView(): [HomeView, (value: HomeView) => void] {
    const view = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current, () => current);
    useEffect(() => {
        if (loaded) return;
        loaded = true;
        void readCache<HomeView>('app', 'homeView').then(value => { if (value && VIEWS.includes(value)) set(value); }).catch(() => {});
    }, []);
    const choose = useCallback((value: HomeView) => {
        set(value);
        void writeCache('app', 'homeView', value).catch(() => {});
    }, []);
    return [view, choose];
}
