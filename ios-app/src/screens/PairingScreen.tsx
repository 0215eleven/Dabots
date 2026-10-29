import { createMobileClient } from "../network/client";
import { tr } from "../i18n";
import { useI18n } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Keyboard, Platform, ScrollView, Switch, Text, View } from "react-native";
import { BotAvatar, mainLook } from "../components/BotAvatar";
import { PairingScanner } from "../components/PairingScanner";
import { MobileClient, validateServerUrl } from "@ds-bot/mobile-sdk";
import {
  Button,
  Card,
  Field,
  Label,
  Notice,
  Sheet,
  styles,
} from "../components/UI";
import { cache, Host, tokenStoreFor } from "../storage";
import { parsePairing } from "../logic/pairing";
import { useTheme } from "../theme";
export function PairingScreen({
  slot,
  onConnected,
  onCancel,
}: {
  /** Credential slot the new pairing is stored in. */
  slot: string;
  onConnected: (host: Host, client: MobileClient) => Promise<void>;
  /** Present when another computer is already paired. */
  onCancel?: () => void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const [raw, setRaw] = useState("");
  const [device, setDevice] = useState(
    Platform.OS === "web"
      ? "Browser preview"
      : `My ${Platform.OS === "ios" ? "iPhone" : "Android"}`,
  );
  const [insecure, setInsecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const attempt = useRef(0);
  const pairingActive = useRef(false);
  const clientRef = useRef<MobileClient | null>(null);
  useEffect(
    () => () => {
      attempt.current++;
      clientRef.current?.dispose();
    },
    [],
  );
  async function pair(input = raw) {
    if (pairingActive.current) return;
    Keyboard.dismiss();
    pairingActive.current = true;
    clientRef.current?.dispose();
    setError("");
    setBusy(true);
    const run = ++attempt.current;
    try {
      const data = parsePairing(input);
      if (!device.trim())
        throw new Error(
          "Paste the complete pairing JSON from your host and enter a device name.",
        );
      const url =
        data.kind === "direct"
          ? validateServerUrl(data.url, { allowInsecure: __DEV__ && insecure })
          : "";
      const client =
        data.kind === "relay"
          ? createMobileClient({
              baseUrl: "https://relay.invalid",
              relay: { relay: data.relay, computerId: data.computerId, computerKey: data.computerKey, serverId: data.serverId },
              tokenStore: tokenStoreFor(slot),
              cache,
            })
          : createMobileClient({
              baseUrl: url,
              tlsPin: data.tlsPin,
              tokenStore: tokenStoreFor(slot),
              cache,
              allowInsecure: __DEV__ && insecure,
            });
      clientRef.current = client;
      const info = await client.info();
      if (info.serverId !== data.serverId)
        throw new Error(
          "The server identity does not match this pairing code. Generate a new code on your host.",
        );
      const pairing = await client.pair(data.code, device.trim());
      setRaw("");
      setStatus("Waiting for approval on your computer…");
      const deadline = Date.now() + 120000;
      while (attempt.current === run && Date.now() < deadline) {
        const result = await client.completePairing(pairing.claimToken);
        if (attempt.current !== run) return;
        if ("accessToken" in result) {
          clientRef.current = null;
          await onConnected(
            {
              url: data.kind === "relay" ? client.baseUrl : url,
              tlsPin: client.tlsPin,
              serverId: info.serverId,
              name: info.name || "My DSH host",
              allowInsecure: data.kind === "direct" && __DEV__ && insecure,
              slot,
              ...(data.kind === "relay"
                ? { relay: { relay: data.relay, computerId: data.computerId, computerKey: data.computerKey } }
                : {}),
            },
            client,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (attempt.current === run)
        throw new Error(
          "Pairing expired. Generate a new code on your computer.",
        );
    } catch (err) {
      if (attempt.current === run)
        setError(
          err instanceof Error
              ? err.message
              : "Pairing failed.",
        );
    } finally {
      if (attempt.current === run) {
        pairingActive.current = false;
        setBusy(false);
        setStatus("");
      }
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.page,
        {
          flexGrow: 1,
          justifyContent: "center",
          maxWidth: 560,
          width: "100%",
          alignSelf: "center",
          paddingVertical: 42,
        },
      ]}
    >
      <View style={{ alignItems: "center", gap: 12, paddingBottom: 12 }}>
        <BotAvatar bot={mainLook} size={72} />
        <Text style={{ color: t.ink, fontSize: 28, fontWeight: "600" }}>
          {tr("DeepSeek Bot Pro")}</Text>
        <Label muted>{tr(onCancel ? "Add another computer." : "Connect to your Bot team.")}</Label>
      </View>
      {Platform.OS === "web" && (
        <Notice
          text={tr(
            "Browser development preview. Device credentials stay in this tab's memory. Use the iOS or Android app for everyday access.",
          )}
        />
      )}
      <Card>
        <Label>{tr("Connect your host")}</Label>
        <Label muted>
          {tr(
            "This preview uses DeepSeek Bot Pro Bridge. Follow the project installation guide to generate pairing data on your computer, scan it here, then approve your phone on the computer.",
          )}
        </Label>
        <Label muted>
          {tr("Your phone must be able to reach the configured HTTPS endpoint with a trusted certificate. Keep the computer and Bridge running.")}
        </Label>
        <PairingScanner disabled={busy} onScan={(text) => { setRaw(text); void pair(text); }} />
        <Field
          label={tr("Pairing JSON")}
          value={raw}
          onChangeText={setRaw}
          multiline
          numberOfLines={3}
          placeholder={'{"url":"https://your-host…","code":"…","serverId":"…"}'}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <Button
          secondary
          title={tr("Paste pairing info")}
          disabled={busy}
          onPress={() => { void Clipboard.getStringAsync().then(text => { setRaw(text); setError(text.trim() ? "" : "The clipboard is empty."); Keyboard.dismiss(); }).catch(() => setError("Could not read the clipboard. Paste into the field instead.")); }}
        />
        <Field
          label={tr("Device name")}
          value={device}
          onChangeText={setDevice}
          maxLength={80}
          editable={!busy}
        />
        {__DEV__ && (
          <View style={styles.between}>
            <View style={{ flex: 1 }}>
              <Label muted>{tr("Local development HTTP")}</Label>
              <Text style={{ color: t.muted, fontSize: 11 }}>
                {tr("Loopback only. HTTPS is required on a real host.")}
              </Text>
            </View>
            <Switch
              accessibilityLabel={tr("Allow development loopback HTTP")}
              disabled={busy}
              value={insecure}
              onValueChange={setInsecure}
            />
          </View>
        )}
        <Notice error text={tr(error)} />
        <Notice text={tr(status)} />
        <Button
          title={busy ? tr("Waiting for host…") : tr("Connect to my host")}
          disabled={busy || !raw.trim() || !device.trim()}
          onPress={() => void pair()}
        />
        {busy && (
          <Button
            title={tr("Cancel pairing")}
            secondary
            onPress={() => {
              attempt.current++;
              pairingActive.current = false;
              clientRef.current?.dispose();
              clientRef.current = null;
              pairingActive.current = false;
              setBusy(false);
              setStatus("");
            }}
          />
        )}
        {onCancel && !busy && <Button title={tr("Back to my computers")} secondary onPress={onCancel} />}
      </Card>
    </ScrollView>
  );
}
