import { useDsText } from '@ds/text';
import { avatarHueSwatch } from '@openbot/brand/bloub-avatar';
import type { AvatarHue } from '@openbot/contracts/ipc';
import { router } from 'expo-router';
import { Typography } from 'heroui-native';
import { useState } from 'react';
import { Alert } from 'react-native';
import { nameProblem } from '@ds-bot/mobile-sdk';
import { AgentAppearancePicker } from '@/features/agents/components/agent-appearance-picker';
import { SheetFormField } from '@/shared/components/sheet-form-field';
import { SheetScrollView } from '@/shared/components/sheet-scroll-view';
import { SheetSaveAction } from '@/shared/components/sheet-save-action';
import { DsModelFields, type ModelChoice } from '@ds/model-fields';
import { useDs } from '@ds/provider';
import { useDsForm } from '@ds/form-state';
import { mutationProblem } from '@ds/screen-binding';
/** Original appearance/form/sheet composition; DS owns fields and persistence. */
export function AddAgentScreen() {
    const { commands, online, view } = useDs();
    const { tr } = useDsText();
    const [name, setName] = useState(''), [role, setRole] = useState(''), [instructions, setInstructions] = useState(''), [seed, setSeed] = useState('ds-bot'), [color, setColor] = useState(''), [runtime, setRuntime] = useState<ModelChoice>({});
    const [hue, setHue] = useState<AvatarHue | null>(null);
    const [owner] = useState(view?.serverId);
    const dirty = Boolean(name || role || instructions || color || runtime.model || seed !== 'ds-bot');
    const form = useDsForm(dirty);
    const unavailable = !online ? tr('This computer is offline. Reconnect before creating a Bot.')
        : view?.serverId !== owner ? tr('This form belongs to another computer. Reopen it on the current computer.')
        : view?.readOnly ? tr(view.readOnly)
        : !commands || !view?.capabilities.actions.includes('create-bot') ? tr('Creating Bots is not allowed on this computer. Ask its owner to enable Bot management.') : '';
    const available = !unavailable;
    const cleanName = name.trim();
    const invalidName = nameProblem(cleanName);
    const nameIssue = invalidName ? tr(invalidName.startsWith('"') ? 'This name is reserved for group mentions.' : invalidName)
        : cleanName.length > 40 ? tr('Use up to 40 characters for the Bot name.')
        : view?.bots.some(bot => bot.name.toLowerCase() === cleanName.toLowerCase()) ? tr('A Bot named {name} already exists', {name: cleanName}) : '';
    const submit = () => void form.submit(async () => {
        try {
            if (nameIssue || unavailable || !commands) throw Error(nameIssue || unavailable);
            await commands.createBot({ name: cleanName, role, instructions, avatar: { shape: seed }, ...(color ? { color } : {}), ...runtime });
        } catch (error) {
            // A native toolbar submission must not hide its failure below a long form or keyboard.
            const reason = mutationProblem(error).message.trim();
            const message = reason || tr('The computer did not provide a failure reason. Check its connection and DSH configuration.');
            Alert.alert(tr('Could not create Bot'), tr(message));
            if (!reason) throw Error(message);
            throw error;
        }
    }, () => router.back());
    return <SheetScrollView className="bg-sheet" contentContainerClassName="gap-5 px-5 pb-safe-offset-5" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
  <SheetSaveAction dirty={dirty && !form.finished} canSave={Boolean(!nameIssue && available && !form.blocked)} pending={form.saving} label={tr("Create Bot")} pendingLabel={tr("Creating…")} onSave={submit}/>
  {form.error || unavailable ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">{tr(form.error || unavailable)}</Typography.Paragraph> : null}
  <AgentAppearancePicker seed={seed} hue={hue} name={name} nameField={<SheetFormField label={tr("Bot name")} hint={nameIssue || tr('Required. Up to 40 characters.')} isRequired value={name} onChangeText={setName} editable={!form.saving}/>} disabled={form.saving} onSeedChange={setSeed} onHueChange={value => { setHue(value); setColor(value === null ? '' : avatarHueSwatch(value)); }} showFaces={true}/>
  <SheetFormField label={tr("Role")} hint={tr('Optional')} value={role} onChangeText={setRole} editable={!form.saving}/><SheetFormField label={tr("Instructions")} hint={tr('Optional')} value={instructions} onChangeText={setInstructions} editable={!form.saving} multiline/><SheetFormField label={tr("Color")} hint={tr('Optional')} value={color} onChangeText={setColor} editable={!form.saving}/>
  <DsModelFields value={runtime} onChange={setRuntime} disabled={form.saving || !available}/>
 </SheetScrollView>;
}
