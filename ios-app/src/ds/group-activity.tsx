import { tr } from '@ds/text';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Typography } from 'heroui-native';
import { useDs } from './provider';
import { mutationProblem } from './screen-binding';
import type { GroupRound } from '../logic/group-work';
export function GroupActivity({ groupId }: {
    groupId: string;
}) {
    const { view, core } = useDs();
    const [rounds, setRounds] = useState<GroupRound[]>([]), [error, setError] = useState(''), [pending, setPending] = useState(false), [blocked, setBlocked] = useState(false);
    const members = view?.work[groupId]?.members ?? [];
    async function run(action: () => Promise<unknown>) { if (pending || blocked)
        return; setPending(true); try {
        await action();
        setError('');
    }
    catch (error) {
        const problem = mutationProblem(error);
        setError(problem.message);
        setBlocked(!problem.retry);
    }
    finally {
        setPending(false);
    } }
    return <View className="gap-2 p-3">{members.map(member => <View key={member.botId}><Typography.Paragraph>{view?.bots.find(b => b.id === member.botId)?.name ?? member.botId}{tr(":")}{member.phase}{member.detail ? ` · ${member.detail}` : ''}</Typography.Paragraph>{view?.capabilities.actions.includes('stop-member-work') ? <Button isDisabled={pending || blocked} variant="ghost" onPress={() => void run(async () => { await core?.stopGroupMember(groupId, member.botId); })}><Button.Label>{tr("Stop member")}</Button.Label></Button> : null}</View>)}{view?.capabilities.actions.includes('room-progress') ? <Button variant="ghost" onPress={() => void run(async () => { if (core)
        setRounds(await core.groupProgress(groupId)); })}><Button.Label>{tr("Read group progress")}</Button.Label></Button> : null}{rounds.map(round => <View key={round.callId}>{round.speaking ? <Typography.Paragraph>{view?.bots.find(b => b.sourceId === round.speaking)?.name ?? round.speaking}</Typography.Paragraph> : null}{round.replies.map((reply, index) => <View key={reply.groupReplyId ?? index}><Typography.Paragraph weight="semibold">{view?.bots.find(b => b.sourceId === reply.botId)?.name ?? reply.botId}</Typography.Paragraph><Typography.Paragraph selectable>{reply.text ?? reply.kind ?? ''}</Typography.Paragraph></View>)}</View>)}{error ? <Typography.Paragraph accessibilityRole="alert">{error}</Typography.Paragraph> : null}</View>;
}
