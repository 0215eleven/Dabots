import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Typography } from 'heroui-native';
import { useRouter } from 'expo-router';
import { SheetScrollView } from '@/shared/components/sheet-scroll-view';
import { SheetFormField } from '@/shared/components/sheet-form-field';
import { SettingsRow, SettingsSection } from '@/features/settings/components/settings-content';
import { useAdminRelay } from '../src/session/admin-relay';
import { useSession } from '../src/session/SessionProvider';
import { useI18n } from '../src/i18n';
import { createRelayAdmin, RelayAdminError, type RelayDevice } from '../src/logic/relay-admin';
import { relayAdminKey } from '../src/storage/admin-key';
import { errorFeedback, successFeedback } from '../src/media/haptics';

type Admin = ReturnType<typeof createRelayAdmin>;
const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;

/** This phone as the relay's admin: claim it once, then approve or remove computers. */
export default function RelayAdmin() {
    const { tr } = useI18n();
    const router = useRouter();
    const { host } = useSession();
    const relay = useAdminRelay();
    const [admin, setAdmin] = useState<Admin | null>(null);
    const [publicKey, setPublicKey] = useState('');
    const [status, setStatus] = useState<{ admin: boolean; claimable: boolean } | null>(null);
    const [devices, setDevices] = useState<{ pending: RelayDevice[]; approved: RelayDevice[] } | null>(null);
    const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const fail = (problem: unknown) => { errorFeedback(); setError(problem instanceof RelayAdminError ? tr('The relay refused this request ({code}).', { code: problem.code }) : tr(problem instanceof Error ? problem.message : String(problem))); };
    const refresh = useCallback(async (client: Admin | null = admin) => {
        if (!client) return;
        setError('');
        try {
            const next = await client.status();
            setStatus(next);
            setDevices(next.admin ? await client.devices() : null);
        } catch (problem) { fail(problem); }
    }, [admin]);
    useEffect(() => {
        if (!relay) return;
        let alive = true;
        void relayAdminKey().then(key => {
            if (!alive) return;
            const client = createRelayAdmin({ relay, key });
            setPublicKey(key.publicKey); setAdmin(client); void refresh(client);
        }).catch(fail);
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [relay]);
    const run = async (work: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true); setError('');
        try { await work(); successFeedback(); await refresh(); } catch (problem) { fail(problem); } finally { setBusy(false); }
    };
    const remove = (device: RelayDevice) => Alert.alert(tr('Remove {name}?', { name: device.name || short(device.computerId) }), tr('This computer is disconnected from the relay until you approve it again.'), [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr('Remove'), style: 'destructive', onPress: () => void run(() => admin!.revoke(device.computerId)) },
    ]);
    const time = (value?: number) => value ? new Date(value).toLocaleString() : '';

    const backToPairing = !host ? <Button variant="secondary" isDisabled={busy} onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/pairing');
    }}><Button.Label>{tr('Back to pairing')}</Button.Label></Button> : null;
    if (!relay) return <SheetScrollView contentContainerClassName="gap-6 p-5">{backToPairing}<Typography.Paragraph>{tr('No relay to manage: pair a computer through the official connection first.')}</Typography.Paragraph></SheetScrollView>;
    return <SheetScrollView contentContainerClassName="gap-6 px-4 pt-5 pb-8" keyboardShouldPersistTaps="handled">
      {backToPairing}
      {error ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text px-1">{error}</Typography.Paragraph> : null}
      {!status ? <Typography.Paragraph className="text-muted px-1">{tr('Checking the relay…')}</Typography.Paragraph> : null}
      {status && !status.admin && status.claimable ? <View className="gap-4">
        <Typography.Paragraph className="text-muted px-1">{tr('Make this phone the relay admin with the one-time code on the server. Only the admin can approve which computers may use the relay.')}</Typography.Paragraph>
        <SheetFormField label={tr('One-time admin code')} hint={tr('On the server: sudo cat /var/lib/ds-bot-relay/admin-bootstrap-code')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} editable={!busy} />
        <Button isDisabled={busy || code.trim().length < 16} onPress={() => void run(() => admin!.claim(code))}><Button.Label>{tr('Become the admin')}</Button.Label></Button>
      </View> : null}
      {status && !status.admin && !status.claimable ? <Typography.Paragraph className="text-muted px-1">{tr('This relay already has an admin. This phone is not one of them.')}</Typography.Paragraph> : null}
      {status?.admin && devices ? <>
        <SettingsSection title={tr('Waiting for approval')}>
          {devices.pending.length ? devices.pending.map(device => <SettingsRow key={device.computerId} supportingText={`${short(device.computerId)} · ${time(device.lastSeenAt)}`}
            trailing={<View className="flex-row gap-2">
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void run(() => admin!.deny(device.computerId))}><Button.Label>{tr('Deny')}</Button.Label></Button>
              <Button size="sm" isDisabled={busy} onPress={() => void run(() => admin!.approve(device.computerId))}><Button.Label>{tr('Approve')}</Button.Label></Button>
            </View>}>
            <Typography.Paragraph>{device.name || tr('Unnamed computer')}</Typography.Paragraph>
          </SettingsRow>) : <SettingsRow><Typography.Paragraph className="text-muted">{tr('No computer is waiting.')}</Typography.Paragraph></SettingsRow>}
        </SettingsSection>
        <SettingsSection title={tr('Approved computers')}>
          {devices.approved.length ? devices.approved.map(device => <SettingsRow key={device.computerId} supportingText={short(device.computerId)}
            trailing={<Button size="sm" variant="ghost" isDisabled={busy} onPress={() => remove(device)}><Button.Label className="text-danger-text">{tr('Remove')}</Button.Label></Button>}>
            <Typography.Paragraph>{device.name || tr('Unnamed computer')}</Typography.Paragraph>
          </SettingsRow>) : <SettingsRow><Typography.Paragraph className="text-muted">{tr('No approved computers yet.')}</Typography.Paragraph></SettingsRow>}
        </SettingsSection>
        <Button variant="secondary" isDisabled={busy} onPress={() => void refresh()}><Button.Label>{tr('Refresh')}</Button.Label></Button>
      </> : null}
      {publicKey ? <Typography.Paragraph className="text-muted px-1" style={{ fontSize: 12 }}>{tr('This phone\'s admin key: {key}', { key: `${publicKey.slice(0, 10)}…` })}</Typography.Paragraph> : null}
    </SheetScrollView>;
}
