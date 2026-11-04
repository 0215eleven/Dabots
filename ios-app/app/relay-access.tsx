import React, { useEffect, useRef, useState } from "react";
import { Alert, Text } from "react-native";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { Button, Card, Field, Label } from "../src/components/UI";
import { useSession } from "../src/session/SessionProvider";
import { useI18n } from "../src/i18n";
import { useTheme } from "../src/theme";
import { officialRelay } from "../src/logic/hosts";
import { createRelayAccess, RelayAccessError } from "../src/logic/relay-access";
import { relayPhoneKey, resetRelayPhoneKey } from "../src/storage/relay-key";

type Access = ReturnType<typeof createRelayAccess>;
/** This route is available before any host exists. Only the configured official origin receives invitations. */
export default function RelayAccess() {
  const { tr } = useI18n(), t = useTheme(), router = useRouter();
  const { host } = useSession();
  const relay = officialRelay();
  const [client, setClient] = useState<Access|null>(null);
  const [enrolled, setEnrolled] = useState<boolean|null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const active = useRef(true), working = useRef(false);
  const fail = (problem:unknown) => setError(tr(problem instanceof RelayAccessError ? problem.message : "Could not reach the official connection. Check your network and retry."));
  async function run(work:()=>Promise<void>) {
    if(working.current) return;
    working.current=true; setBusy(true); setError("");
    try { await work(); } catch(problem) { if(active.current) fail(problem); }
    finally { working.current=false; if(active.current) setBusy(false); }
  }
  async function refresh(reset=false) {
    if(!relay) return;
    const key = await (reset ? resetRelayPhoneKey(relay) : relayPhoneKey(relay));
    const next = createRelayAccess({relay,key,randomBytes:length=>Crypto.getRandomBytes(length)});
    if(!active.current) return;
    setClient(next);
    const status = await next.status();
    if(active.current) setEnrolled(status.enrolled);
  }
  useEffect(()=>{active.current=true; void run(()=>refresh());return()=>{active.current=false;};},[relay]);
  const back = () => { if(router.canGoBack()) router.back(); else router.replace("/pairing"); };
  const reset = () => Alert.alert(tr("Reset this phone identity?"),tr("Ask the server owner to revoke this phone's old identity before resetting. Saved computers and chats stay here; use a new invitation and scan each computer again."),[
    {text:tr("Cancel"),style:"cancel"},
    {text:tr("Reset phone identity"),style:"destructive",onPress:()=>{setCode("");setEnrolled(null);void run(()=>refresh(true));}},
  ]);
  return <SheetScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-4 pb-8">
    {!host ? <Button title={tr("Back to pairing")} secondary disabled={busy} onPress={back}/> : null}
    <Label large>{tr("Connection invitation")}</Label>
    {!relay ? <Label muted>{tr("This build has no official connection configured.")}</Label> : <>
      <Label muted>{tr("Use an invitation to enroll this phone, then scan your computers. One invitation enrolls one phone.")}</Label>
      {error ? <Text accessibilityRole="alert" style={{color:t.error}}>{error}</Text> : null}
      {busy ? <Label muted>{tr("Checking the official connection…")}</Label> : null}
      {enrolled ? <Card><Label>{tr("This phone is enrolled. Scan a fresh code from each computer to connect.")}</Label></Card> : <Card>
        <Field label={tr("Invitation code")} value={code} onChangeText={setCode} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} textContentType="none" autoComplete="off" />
        <Button title={tr("Use invitation")} disabled={busy || !client || !code.trim()} onPress={()=>{
          if(working.current || !client) return;
          const invitation=code.trim(); setCode("");
          void run(async()=>{await client.redeem(invitation);const status=await client.status();if(active.current)setEnrolled(status.enrolled);});
        }}/>
      </Card>}
      <Button title={tr("Retry")} secondary disabled={busy} onPress={()=>void run(()=>refresh())}/>
      <Button title={tr("Reset phone identity")} secondary danger disabled={busy} onPress={reset}/>
    </>}
  </SheetScrollView>;
}
