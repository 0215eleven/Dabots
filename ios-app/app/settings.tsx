import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import CheckIcon from "lucide-react-native/icons/check";
import { useThemeColor } from "heroui-native/hooks";
import { Button, Typography } from "heroui-native";
import { Host as UiHost, Picker, Switch } from "@expo/ui";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { hostAddress } from "../src/logic/hosts";
import { setLiveActivityEnabled } from "../src/liveactivity/controller";
import { LocalePreference, setLocalePreference, useI18n } from "../src/i18n";
import { errorFeedback, selectionFeedback, successFeedback } from "../src/media/haptics";
import { useSession } from "../src/session/SessionProvider";
import { readCache, writeCache } from "../src/storage";
import { ColorMode, setColorMode, useColorMode } from "../src/theme";
import { SettingsSection, SettingsRow } from "@/features/settings/components/settings-content";
import { useDs } from "../src/ds/provider";
import { mutationProblem } from "../src/ds/screen-binding";
import { THEMES } from "../src/theme";
import { saveLocalePreference } from "../src/logic/locale-preference";
import { errorText } from "../src/types";

const Group = SettingsSection;
// The computer's accent choices, drawn as swatches; `null` is the theme's own accent (DeepSeek blue).
const ACCENTS: { value: string | null; swatch: string }[] = [{ value: null, swatch: '#4D6BFE' }, { value: '#3b6fd8', swatch: '#3b6fd8' }, { value: '#d97757', swatch: '#d97757' }, { value: '#228866', swatch: '#228866' }];
function Row({title,detail,onPress,destructive,children}:{title:string;detail?:string;onPress?:()=>void;destructive?:boolean;children?:React.ReactNode}) {return <SettingsRow supportingText={detail} onPress={onPress} trailing={children}><Typography.Paragraph className={destructive?'text-danger-text':undefined}>{title}</Typography.Paragraph></SettingsRow>}

function Settings() {
  const { tr, locale, preference: language } = useI18n();
  const localeSaves = useRef(Promise.resolve());
  const latestLocaleIntent = useRef(0);
  const [localeSaveStatus, setLocaleSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const router = useRouter();
  const session = useSession();
  const {view,commands,management}=useDs();
  const [reviewed,setReviewed]=useState<import("../src/ds/management").ManagementIssue[]>([]);
  const [sharedPending,setSharedPending]=useState(false),[sharedBlocked,setSharedBlocked]=useState(false);
  const saveShared=async(patch:import('../src/ds/contracts').DsPreferences)=>{if(!commands||sharedPending||sharedBlocked)return;setSharedPending(true);try{await commands.setPreferences(patch);setMessage('')}catch(error){const problem=mutationProblem(error);setMessage(problem.message);setSharedBlocked(!problem.retry)}finally{setSharedPending(false)}};

  const mode = useColorMode();
  const [accent, success, muted] = useThemeColor(['accent', 'success', 'muted']);
  const [island, setIsland] = useState(true);
  const [message, setMessage] = useState("");
  const host = session.host;

  useEffect(() => {
    void readCache<boolean>("app", "liveActivity").then(value => { const on = value !== false; setIsland(on); setLiveActivityEnabled(on); }).catch(() => {});
  }, []);


  const status = !host ? tr("Not paired") : session.workspace.online ? tr("Connected") : tr("Connecting…");
  const changeMode = (value: ColorMode) => { selectionFeedback(); setColorMode(value); void writeCache("app", "colorMode", value); };
  const changeLanguage = (value: LocalePreference) => {
    selectionFeedback();
    const intent = ++latestLocaleIntent.current;
    setLocalePreference(value);
    setLocaleSaveStatus(host ? 'saving' : 'idle');
    if (!host) return;
    // Serialize rapid changes to this computer's existing preference record.
    localeSaves.current = localeSaves.current.catch(() => {}).then(() => saveLocalePreference({
      read: (scope, key) => readCache<Record<string, unknown>>(scope, key, {strict:true}),
      write: writeCache,
    }, host.serverId, value)).then(() => {
      if (active.current && intent === latestLocaleIntent.current) setLocaleSaveStatus('saved');
    }).catch(() => {
      if (active.current && intent === latestLocaleIntent.current) setLocaleSaveStatus('failed');
    });
  };
  const changeIsland = (value: boolean) => { selectionFeedback(); setIsland(value); setLiveActivityEnabled(value); void writeCache("app", "liveActivity", value); };
  const unpair = () => Alert.alert(tr("Unpair this computer?"), tr("Its chats are removed from this phone. Pair again to reconnect."), [
    { text: tr("Cancel"), style: "cancel" },
    { text: tr("Unpair"), style: "destructive", onPress: () => { errorFeedback(); session.disconnect().catch(err => setMessage(errorText(err))); } },
  ]);
  const forget = (target: (typeof session.hosts)[number]) => Alert.alert(tr("Forget {p0}?", { p0: target.name }), undefined, [
    { text: tr("Cancel"), style: "cancel" },
    { text: tr("Forget"), style: "destructive", onPress: () => void session.forgetHost(target).catch(err => setMessage(errorText(err))) },
  ]);

  return (
    <LargeTitleScrollView title={tr("Settings")} caption={host?.name} contentContainerClassName="gap-6 px-4 pt-3">
      <Stack.Screen options={{ title: "", headerTransparent: true, headerShadowVisible: false }} />
      {message || session.error ? <Typography.Paragraph className="text-danger-text px-1">{tr(message || session.error)}</Typography.Paragraph> : null}
      {localeSaveStatus === 'failed' ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text px-1">{tr('Language changed for this session, but could not be saved on this device.')}</Typography.Paragraph> : null}
      <Group title={tr("Connection")} footer={tr("The app reconnects automatically when you change networks or return to the app.")}>
        <Row title={host?.name || tr("No computer paired")} detail={host ? hostAddress(host) : undefined}>
          <View className="flex-row items-center gap-1.5"><View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: String(session.workspace.online ? success : muted) }}/><Typography.Paragraph className="text-muted" style={{ fontSize: 15 }}>{status}</Typography.Paragraph></View>
        </Row>
        <Row title={tr("Reconnect now")} onPress={host ? () => { successFeedback(); session.resume(); } : undefined} />
      </Group>

      <Group title={tr("Computers")}>
        {session.hosts.map(item => (
          <Row key={item.slot || item.serverId} title={item.name} detail={hostAddress(item)} onPress={host && item.serverId === host.serverId ? undefined : () => { selectionFeedback(); void session.switchHost(item); }}>
            {host && item.serverId === host.serverId ? <CheckIcon accessibilityLabel={tr("Selected")} size={20} color={String(accent)} strokeWidth={2.4}/>
              : <Pressable accessibilityRole="button" accessibilityLabel={tr("Forget {p0}?", { p0: item.name })} onPress={() => forget(item)} hitSlop={10}><Typography.Paragraph className="text-danger-text" style={{ fontSize: 15 }}>{tr("Forget")}</Typography.Paragraph></Pressable>}
          </Row>
        ))}
        <Row title={tr("Pair a computer")} onPress={() => router.push("/pairing")} />
      </Group>


      {management?.issues().length ? <Group title={tr("Changes need review")} footer={tr("Check the current desktop state before allowing another operation.")}>
        {management.issues().map(issue=><Row key={issue.key} title={`${tr(({createBot:'Create Bot',updateBot:'Edit Bot',duplicateBot:'Duplicate Bot',deleteBot:'Delete Bot',setMainBot:'Change main Bot',createGroup:'Create group',updateGroup:'Edit group',deleteGroup:'Delete group',setFlags:'Change chat visibility or pin',setPreferences:'Computer appearance',cancel:'Stop response',stopGroupMember:'Stop group member'} as Record<string,string>)[issue.key.split(':')[0]] ?? 'Change')}${[...(view?.bots??[]),...(view?.groups??[])].find(item=>issue.key.includes(item.id))?.name ? ' · '+[...(view?.bots??[]),...(view?.groups??[])].find(item=>issue.key.includes(item.id))!.name : ''}`} detail={tr(issue.message)}/>)}
        <Row title={tr("Read current desktop state")} onPress={()=>void management.review().then(setReviewed).catch(error=>setMessage(errorText(error)))}/>
        {reviewed.length ? <Row title={tr("I checked the current state")} onPress={()=>{management.acknowledge(reviewed);setReviewed([]);setSharedBlocked(false);setMessage('')}}/> : null}
      </Group> : null}
      <Group title={tr("Computer appearance")} footer={tr("Synced with the computer; its confirmed settings take effect.")}>
        <Row title={tr("Theme")}><UiHost matchContents><Picker enabled={!sharedPending&&!sharedBlocked&&Boolean(view?.capabilities.actions.includes("set-prefs"))} selectedValue={String(view?.preferences.theme??'deepseek')} onValueChange={theme=>void saveShared({theme:String(theme)})}>{Object.entries(THEMES).map(([id,value])=><Picker.Item key={id} label={tr(value.name)} value={id}/>)}</Picker></UiHost></Row>
        <Row title={tr("Accent")}>
          <View className="flex-row items-center gap-2.5">{ACCENTS.map(option => { const selected = (view?.preferences.accent ?? null) === option.value; const disabled = sharedPending || sharedBlocked || !view?.capabilities.actions.includes('set-prefs'); return <Pressable key={option.value ?? 'default'} accessibilityRole="radio" accessibilityState={{ selected, disabled }} accessibilityLabel={option.value ? option.value : tr('Default')} disabled={disabled} hitSlop={4} onPress={() => { selectionFeedback(); void saveShared({ accent: option.value }); }} style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 15, padding: 3, borderWidth: 2, borderColor: selected ? option.swatch : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}><View style={{ flex: 1, borderRadius: 12, backgroundColor: option.swatch }}/></Pressable>; })}</View>
        </Row>
        <Row title={tr("Motion")}><UiHost matchContents><Picker enabled={!sharedPending&&!sharedBlocked&&Boolean(view?.capabilities.actions.includes("set-prefs"))} selectedValue={String(view?.preferences.motion??'normal')} onValueChange={motion=>void saveShared({motion:motion as 'quiet'|'normal'|'lively'})}>{['quiet','normal','lively'].map(value=><Picker.Item key={value} label={tr(value)} value={value}/>)}</Picker></UiHost></Row>
      </Group>
      <Group title={tr("Phone appearance and preferences")}>
        <Row title={tr("Theme")}>
          <UiHost matchContents>
            <Picker selectedValue={mode} onValueChange={value => changeMode(value as ColorMode)} appearance="menu">
              <Picker.Item label={tr("System")} value="system" />
              <Picker.Item label={tr("Light")} value="light" />
              <Picker.Item label={tr("Dark")} value="dark" />
            </Picker>
          </UiHost>
        </Row>
        <Row title={tr("Language")}>
          <UiHost matchContents>
            <Picker selectedValue={language} onValueChange={value => void changeLanguage(value as LocalePreference)} appearance="menu">
              <Picker.Item label={tr("Follow computer")} value="host" />
              <Picker.Item label={tr("System")} value="system" />
              <Picker.Item label="English" value="en" />
              <Picker.Item label="简体中文" value="zh" />
            </Picker>
          </UiHost>
        </Row>
        {Platform.OS === "ios" ? (
          <Row title={tr("Dynamic Island")} detail={tr("Show what your Bots are doing on the Lock Screen and Dynamic Island while the app is open.")}>
            <UiHost matchContents><Switch value={island} onValueChange={changeIsland} /></UiHost>
          </Row>
        ) : null}
      </Group>

      <Group title={tr("More")}>
        {view?.capabilities.agents?<Row title={tr("DSH Agent")} detail={tr("Owner-granted Agent conversations")} onPress={() => router.push("/classic")} />:null}
        {host ? <Row title={tr("Unpair this computer")} destructive onPress={unpair} /> : null}
      </Group>
      <Typography.Paragraph className="text-muted text-center" style={{ fontSize: 12 }}>DeepSeek Bot Pro {Constants.expoConfig?.version} · {locale}</Typography.Paragraph>
    </LargeTitleScrollView>
  );
}

export default function SettingsRoute(){const {host}=useSession();return <Settings key={host?.serverId??"unpaired"}/>;}
