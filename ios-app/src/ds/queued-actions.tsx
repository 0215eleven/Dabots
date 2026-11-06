// DS Bot Mobile: a message the computer accepted while the Bot was busy waits in the computer's
// queue. From the phone it can be steered into the running turn or withdrawn; a card whose message
// the queue no longer holds can be cleared from this phone.
import { useDsText } from '@ds/text';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Typography } from 'heroui-native';
import type { DsCore } from './contracts';
import { errorFeedback, successFeedback } from '../media/haptics';
import { mutationProblem } from './screen-binding';

export function QueuedActions({ core, conversationId, itemId, requestId, canSteer, canRemove }: {
    core: DsCore;
    conversationId: string;
    itemId?: string;
    requestId?: string;
    /** Steering needs a running turn and a desktop plugin that offers it. */
    canSteer: boolean;
    canRemove: boolean;
}) {
    const { tr } = useDsText();
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [missing, setMissing] = useState(false);
    async function run(kind: 'steer' | 'remove') {
        if (busy) return;
        setBusy(true); setError('');
        try {
            const result = await core.updateQueued(conversationId, { itemId, requestId }, kind);
            if (result.missing) { setMissing(true); return; }
            successFeedback();
        } catch (problem) {
            errorFeedback();
            if (String((problem as { code?: unknown })?.code ?? '').toUpperCase() === 'QUEUE_CHANGED') setMissing(true);
            else setError(mutationProblem(problem).message);
        } finally { setBusy(false); }
    }
    function withdraw() {
        Alert.alert(tr('Withdraw this message?'), tr('The Bot will not receive it.'), [
            { text: tr('Cancel'), style: 'cancel' },
            { text: tr('Withdraw'), style: 'destructive', onPress: () => void run('remove') },
        ]);
    }
    async function forget() {
        if (!requestId || busy) return;
        setBusy(true);
        try { await core.forgetSent(requestId); } catch (problem) { setError(mutationProblem(problem).message); } finally { setBusy(false); }
    }
    if (!canSteer && !canRemove && !requestId) return null;
    return <View className="gap-1.5">
      {missing ? <Typography.Paragraph type="body-xs" className="text-muted">{tr('The computer no longer holds this message in its queue. It may already be in the conversation.')}</Typography.Paragraph> : null}
      <View className="flex-row flex-wrap gap-2">
        {!missing && canSteer ? <Button size="sm" isDisabled={busy} onPress={() => void run('steer')}><Button.Label>{tr('Steer now')}</Button.Label></Button> : null}
        {!missing && canRemove ? <Button size="sm" variant="secondary" isDisabled={busy} onPress={withdraw}><Button.Label>{tr('Withdraw')}</Button.Label></Button> : null}
        {requestId && (missing || !canRemove) ? <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void forget()}><Button.Label>{tr('Remove from this phone')}</Button.Label></Button> : null}
      </View>
      {error ? <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="text-danger-text">{tr(error)}</Typography.Paragraph> : null}
    </View>;
}
