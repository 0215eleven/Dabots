import {useEffect, useMemo, useSyncExternalStore} from 'react';
import type {DsCore} from './contracts';
import {cache} from '../storage';
import {createDraft} from './draft';
export function useDsDraft(core: DsCore | null, id: string) {
    const draft = useMemo(() => core ? createDraft(core, id, cache) : null, [core, id]);
    if (!draft) throw Error('Draft requires the selected DS session.');
    const text = useSyncExternalStore(draft.subscribe, draft.get, draft.get);
    useEffect(() => {void draft.load().catch(() => {}); return () => draft.dispose();}, [draft]);
    return {...draft, text};
}
