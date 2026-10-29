import { tr } from './text';
import { useRef, useState } from 'react';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert } from 'react-native';
import { mutationProblem } from './screen-binding';
/** A management uncertainty freezes Save; refreshing never silently authorizes another create. */
export function useDsForm(dirty: boolean) {
    const lock = useRef(false);
    const [saving, setSaving] = useState(false), [finished, setFinished] = useState(false), [blocked, setBlocked] = useState(false), [error, setError] = useState(''), [discarding, setDiscarding] = useState(false);
    usePreventRemove(!discarding && !finished && (dirty || saving), ({ repeat }) => { if (lock.current)
        return; Alert.alert(tr('Discard changes?'), tr('Your unsaved edits will be lost.'), [{ text: tr('Keep editing'), style: 'cancel' }, { text: tr('Discard'), style: 'destructive', onPress: () => { setDiscarding(true); setTimeout(repeat, 0); } }]); });
    async function submit(action: () => Promise<unknown>, done?: () => void, finish = true) { if (lock.current || blocked)
        return; lock.current = true; setSaving(true); try {
        await action();
        if (finish) setFinished(true);
        setError('');
        if (done)
            setTimeout(done, 0);
    }
    catch (error) {
        const problem = mutationProblem(error);
        setError(problem.message);
        setBlocked(!problem.retry);
    }
    finally {
        lock.current = false;
        setSaving(false);
    } }
    return { saving, finished, blocked, error, submit, edit: () => setFinished(false) };
}
