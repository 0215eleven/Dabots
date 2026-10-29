import { botAvatarHue, botAvatarColor } from '@ds/presentation';
import { tr } from '@ds/text';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Typography } from 'heroui-native';
import { useState } from 'react';
import { useUniwind } from 'uniwind';
import { BloubAvatarPreview } from '@/features/agents/components/bloub-avatar';
import { SheetFormField } from '@/shared/components/sheet-form-field';
import { SheetScrollView } from '@/shared/components/sheet-scroll-view';
import { SheetSaveAction } from '@/shared/components/sheet-save-action';
import { SettingsRow, SettingsSection } from '@/features/settings/components/settings-content';
import { DsModelFields } from '@ds/model-fields';
import { useDs } from '@ds/provider';
import { useDsForm } from '@ds/form-state';
import type { DsBotPatch, DsBotView } from '@ds/contracts';
import { Unavailable } from '@ds/routes';
export function EditAgentScreen() { const { agentId } = useLocalSearchParams<{
    agentId: string;
}>(); const { view } = useDs(); const bot = view?.bots.find(b => b.id === agentId); return bot ? <BotForm key={bot.id} bot={bot}/> : <Unavailable />; }
function BotForm({ bot }: {
    bot: DsBotView;
}) {
    const { view, commands, core, online } = useDs();
    const { theme } = useUniwind();
    const [edits, setEdits] = useState<DsBotPatch>({});
    const current = { ...bot, ...edits };
    const form = useDsForm(Object.keys(edits).length > 0);
    const change = (patch: DsBotPatch) => { form.edit(); setEdits(old => ({ ...old, ...patch })); };
    const available = online && !view?.readOnly && view?.serverId === bot.serverId && view.capabilities.actions.includes('update-bot');
    return <SheetScrollView className="bg-sheet" contentContainerClassName="gap-5 px-5 pb-safe-offset-5" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
  <BloubAvatarPreview agentId={bot.id} serverId={bot.serverId} seed={bot.avatar?.shape ?? bot.sourceId} hue={botAvatarHue(current)} color={botAvatarColor(current, theme === 'dark')} size={112}/>
  <SheetFormField label={tr("Bot name")} value={current.name} editable={!form.saving} onChangeText={name => change({ name })}/><SheetFormField label={tr("Role")} value={current.role ?? ''} editable={!form.saving} onChangeText={role => change({ role })}/><SheetFormField label={tr("Instructions")} value={current.instructions ?? ''} editable={!form.saving} multiline onChangeText={instructions => change({ instructions })}/><SheetFormField label={tr("Avatar shape")} value={edits.avatar?.shape ?? bot.avatar?.shape ?? ''} editable={!form.saving} onChangeText={shape => change({ avatar: { ...bot.avatar, shape } })}/><SheetFormField label={tr("Color (hex)")} value={current.color ?? ''} editable={!form.saving} onChangeText={color => change({ color: color || null })}/>
  <DsModelFields value={{ model: edits.model === undefined ? bot.modelRef : edits.model, effort: edits.effort === undefined ? bot.effortId : edits.effort }} onChange={change} disabled={!available || form.saving}/>
  {form.error ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">{form.error}</Typography.Paragraph> : null}
  <SheetSaveAction dirty={Object.keys(edits).length > 0 && !form.finished} canSave={Boolean(available && current.name.trim() && !form.blocked)} pending={form.saving} onSave={() => void form.submit(async () => { if (!commands)
        throw Error('Unavailable'); await commands.updateBot(bot.id, edits); }, () => setEdits({}))}/>
  <SettingsSection title={tr("Bot")}><SettingsRow supportingText={view?.work[bot.id]?.detail ?? view?.work[bot.id]?.phase}><Typography.Paragraph>{tr("Runtime")}</Typography.Paragraph></SettingsRow>
   {view?.capabilities.actions.includes('set-main') ? <Button isDisabled={!available || form.saving || form.blocked} variant="secondary" onPress={() => void form.submit(async () => { await core?.setMainBot(bot.id, { main: true }); }, undefined, false)}><Button.Label>{tr("Set main Bot")}</Button.Label></Button> : null}
  </SettingsSection>
 </SheetScrollView>;
}
