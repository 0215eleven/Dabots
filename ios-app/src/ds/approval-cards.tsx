// DS Bot Mobile: tool approvals waiting in this conversation, answered from the phone. They only
// arrive when the owner allowed this phone to answer approvals on the computer; the computer's own
// card stays usable and whichever answers first decides.
import { useDsText } from '@ds/text';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Typography } from 'heroui-native';
import type { ToolApproval } from '@ds-bot/mobile-sdk';
import { errorFeedback, successFeedback } from '../media/haptics';
import { mutationProblem } from './screen-binding';
import type { DsCore } from './contracts';

export function ApprovalCards({ approvals, background, botName, onAnswer }: {
    approvals: readonly ToolApproval[];
    background: string;
    botName?: (id: string) => string | undefined;
    onAnswer: (approvalId: string, choice: 'allow' | 'reject') => Promise<void>;
}) {
    const { tr } = useDsText();
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');
    // An answered card goes at once; a slower poll may still list it for a moment.
    const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
    const open = approvals.filter(item => !answered.has(item.id));
    if (!open.length) return error ? <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="mx-4 mb-2 text-danger-text">{tr(error)}</Typography.Paragraph> : null;
    async function answer(id: string, choice: 'allow' | 'reject') {
        if (busy) return;
        setBusy(id); setError('');
        try { await onAnswer(id, choice); setAnswered(previous => new Set([...previous, id])); successFeedback(); }
        catch (problem) {
            // Answered on the computer meanwhile: nothing left to do here.
            if (String((problem as { code?: unknown })?.code ?? '').toUpperCase() === 'APPROVAL_CLOSED') { setAnswered(previous => new Set([...previous, id])); return; }
            errorFeedback(); setError(mutationProblem(problem).message);
        }
        finally { setBusy(null); }
    }
    return <View className="gap-2">
      {open.map(item => <View key={item.id} accessibilityRole="alert" className="mx-4 mb-2 gap-2 rounded-2xl px-3.5 py-3" style={{ backgroundColor: background }}>
        <Typography.Paragraph type="body-xs" className="font-medium text-warning">{item.botId && botName?.(item.botId) ? tr('{name} is waiting for your approval', { name: botName(item.botId)! }) : tr('Waiting for your approval')}</Typography.Paragraph>
        <Typography.Paragraph type="body-sm" className="font-semibold" selectable>{item.tool || tr('Tool call')}</Typography.Paragraph>
        {item.reason ? <Typography.Paragraph type="body-sm" numberOfLines={6} selectable>{item.reason}</Typography.Paragraph> : null}
        <View className="flex-row gap-2">
          <Button size="sm" variant="secondary" isDisabled={busy !== null} onPress={() => void answer(item.id, 'reject')}><Button.Label>{tr('Reject')}</Button.Label></Button>
          <Button size="sm" isDisabled={busy !== null} onPress={() => void answer(item.id, 'allow')}><Button.Label>{tr(busy === item.id ? 'Answering…' : 'Allow once')}</Button.Label></Button>
        </View>
      </View>)}
      {error ? <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="mx-4 mb-2 text-danger-text">{tr(error)}</Typography.Paragraph> : null}
    </View>;
}

/**
 * The stream announces a Bot chat's or Agent's approvals itself. A group member's approval is held
 * by the engine in a hidden Session, so while the computer says someone waits, ask now and then.
 */
export function useWaitingApprovals(core: DsCore | null | undefined, conversationId: string, waiting: boolean, streamed: readonly ToolApproval[]): readonly ToolApproval[] {
    const [polled, setPolled] = useState<ToolApproval[]>([]);
    useEffect(() => {
        if (!core || !waiting) { setPolled([]); return; }
        let alive = true;
        const read = () => { core.approvals(conversationId).then(items => { if (alive) setPolled(items); }, () => {}); };
        read();
        const timer = setInterval(read, 4000);
        return () => { alive = false; clearInterval(timer); };
    }, [core, conversationId, waiting]);
    if (!polled.length) return streamed;
    const seen = new Set(streamed.map(item => item.id));
    return [...streamed, ...polled.filter(item => !seen.has(item.id))];
}
