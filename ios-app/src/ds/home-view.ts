import { useCallback, useEffect, useState } from 'react';
import { readCache, writeCache } from '../storage';

export type HomeView = 'list' | 'office';
let remembered: HomeView | null = null;

/** The home's list or office mode, remembered on this phone across launches and computers. */
export function useHomeView(): [HomeView, (value: HomeView) => void] {
    const [view, setView] = useState<HomeView>(remembered ?? 'list');
    useEffect(() => {
        if (remembered) return;
        let alive = true;
        void readCache<HomeView>('app', 'homeView').then(value => { if (alive && (value === 'list' || value === 'office')) { remembered = value; setView(value); } }).catch(() => {});
        return () => { alive = false; };
    }, []);
    const choose = useCallback((value: HomeView) => {
        remembered = value;
        setView(value);
        void writeCache('app', 'homeView', value).catch(() => {});
    }, []);
    return [view, choose];
}
