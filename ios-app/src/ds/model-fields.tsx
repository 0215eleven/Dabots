import { tr } from '@ds/text';
import { useEffect, useState } from 'react';
import { Button, Typography } from 'heroui-native';
import { View } from 'react-native';
import { SettingsRow, SettingsSection } from '@/features/settings/components/settings-content';
import { useDs } from './provider';
import type { DsModelOptions } from './contracts';
export interface ModelChoice {
    model?: string | null;
    effort?: string | null;
}
/** DSH owns every model reference and effort ID; this component has no provider/account API. */
export function DsModelFields({ value, onChange, disabled }: {
    value: ModelChoice;
    onChange: (value: ModelChoice) => void;
    disabled: boolean;
}) {
    const { view, commands } = useDs();
    const [options, setOptions] = useState<DsModelOptions | null>(null), [error, setError] = useState('');
    useEffect(() => { let current = true; setOptions(null); setError(''); if (value.model && commands)
        void commands.modelOptions(value.model).then(result => { if (current)
            setOptions(result); }).catch(error => { if (current)
            setError(String(error)); }); return () => { current = false; }; }, [commands, value.model]);
    return <SettingsSection title={tr("Model and reasoning · computer")}>
  <SettingsRow><Typography.Paragraph>{value.model || 'Inherit from computer'}</Typography.Paragraph></SettingsRow>
  <View className="flex-row flex-wrap gap-2 p-3"><Button variant="secondary" isDisabled={disabled} onPress={() => onChange({ model: null, effort: null })}><Button.Label>{tr("Inherit")}</Button.Label></Button>{view?.models.map(model => <Button key={model.ref} variant={value.model === model.ref ? 'primary' : 'secondary'} isDisabled={disabled || !view.capabilities.actions.includes('efforts')} onPress={() => onChange({ model: model.ref, effort: null })}><Button.Label>{model.name}</Button.Label></Button>)}</View>
  {value.model ? <View className="flex-row flex-wrap gap-2 p-3"><Button variant="secondary" isDisabled={disabled} onPress={() => onChange({ ...value, effort: null })}><Button.Label>{tr("Default reasoning")}</Button.Label></Button>{options?.efforts.map(effort => <Button key={effort.id} variant={value.effort === effort.id ? 'primary' : 'secondary'} isDisabled={disabled} onPress={() => onChange({ ...value, effort: effort.id })}><Button.Label>{effort.name}</Button.Label></Button>)}</View> : null}
  {error ? <Typography.Paragraph accessibilityRole="alert">{error}</Typography.Paragraph> : null}
 </SettingsSection>;
}
