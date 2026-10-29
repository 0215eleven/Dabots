import React, { useEffect, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
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
import { errorText } from "../src/types";

const Group = SettingsSection;
function Row({title,detail,onPress,destructive,children}:{title:string;detail?:string;onPress?:()=>void;destructive?:boolean;children?:React.ReactNode}) {return <SettingsRow supportingText={detail} onPress={onPress} trailing={children}><Typography.Paragraph className={destructive?'text-danger-text':undefined}>{title}</Typography.Paragraph></SettingsRow>}

function Settings() {
  const { tr, locale } = useI18n();
  const router = useRouter();
  const session = useSession();
  const {view,commands,management}=useDs();
  const [reviewed,setReviewed]=useState<import("../src/ds/management").ManagementIssue[]>([]);
  const [sharedPending,setSharedPending]=useState(false),[sharedBlocked,setSharedBlocked]=useState(false);
  const saveShared=async(patch:import('../src/ds/contracts').DsPreferences)=>{if(!commands||sharedPending||sharedBlocked)return;setSharedPending(true);try{await commands.setPreferences(patch);setMessage('')}catch(error){const problem=mutationProblem(error);setMessage(problem.message);setSharedBlocked(!problem.retry)}finally{setSharedPending(false)}};

  const mode = useColorMode();
  const [island, setIsland] = useState(true);
  const [language, setLanguage] = useState<LocalePreference>("host");
  const [message, setMessage] = useState("");
  const host = session.host;

  useEffect(() => {
    void readCache<boolean>("app", "liveActivity").then(value => { const on = value !== false; setIsland(on); setLiveActivityEnabled(on); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!host) return;
    void readCache<{ locale?: LocalePreference }>(host.serverId, "mobile-preferences").then(value => setLanguage(value?.locale || "host")).catch(() => {});
  }, [host]);

  const status = !host ? tr("Not paired") : session.workspace.online ? tr("Connected") : tr("Connecting…");
  const changeMode = (value: ColorMode) => { selectionFeedback(); setColorMode(value); void writeCache("app", "colorMode", value); };
  const changeLanguage = async (value: LocalePreference) => {
    selectionFeedback();
    setLanguage(value);
    setLocalePreference(value);
    if (host) await writeCache(host.serverId, "mobile-preferences", { ...((await readCache<object>(host.serverId, "mobile-preferences")) || {}), locale: value });
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
      {message || session.error ? <Typography.Paragraph className="text-danger-text px-1">{message || session.error}</Typography.Paragraph> : null}
      <Group title={tr("Connection")} footer={tr("The app keeps one WebSocket per open chat and resumes from where it stopped after a network change or when it returns from the background.")}>
        <Row title={host?.name || tr("No computer paired")} detail={host ? hostAddress(host) : undefined}>
          <Typography.Paragraph className={session.workspace.online ? "text-success-text" : "text-muted"} style={{ fontSize: 14 }}>{status}</Typography.Paragraph>
        </Row>
        <Row title={tr("Reconnect now")} onPress={host ? () => { successFeedback(); session.resume(); } : undefined} />
      </Group>

      <Group title={tr("Computers")}>
        {session.hosts.map(item => (
          <Row key={item.slot || item.serverId} title={item.name} detail={hostAddress(item)} onPress={undefined}>
            {host && item.serverId === host.serverId ? <Typography.Paragraph className="text-accent-text" style={{ fontSize: 14 }}>{tr("Selected")}</Typography.Paragraph>
              : <View className="flex-row gap-2"><Pressable accessibilityRole="button" accessibilityLabel={tr("Select")} onPress={()=>void session.switchHost(item)}><Typography.Paragraph>{tr("Select")}</Typography.Paragraph></Pressable><Pressable accessibilityRole="button" accessibilityLabel={tr("Forget {p0}?", { p0: item.name })} onPress={() => forget(item)} hitSlop={10}><Typography.Paragraph className="text-danger-text" style={{ fontSize: 14 }}>{tr("Forget")}</Typography.Paragraph></Pressable></View>}
          </Row>
        ))}
        <Row title={tr("Pair a computer")} onPress={() => router.push("/pairing")} />
      </Group>


      {management?.issues().length ? <Group title="Changes need review" footer="Check the current desktop state before allowing another operation.">
        {management.issues().map(issue=><Row key={issue.key} title={`${({createBot:'Create Bot',updateBot:'Edit Bot',duplicateBot:'Duplicate Bot',deleteBot:'Delete Bot',setMainBot:'Change main Bot',createGroup:'Create group',updateGroup:'Edit group',deleteGroup:'Delete group',setFlags:'Change chat visibility or pin',setPreferences:'Computer appearance',cancel:'Stop response',stopGroupMember:'Stop group member'} as Record<string,string>)[issue.key.split(':')[0]] ?? 'Change'}${[...(view?.bots??[]),...(view?.groups??[])].find(item=>issue.key.includes(item.id))?.name ? ' · '+[...(view?.bots??[]),...(view?.groups??[])].find(item=>issue.key.includes(item.id))!.name : ''}`} detail={issue.message}/>)}
        <Row title="Read current desktop state" onPress={()=>void management.review().then(setReviewed).catch(error=>setMessage(errorText(error)))}/>
        {reviewed.length ? <Row title="I checked the current state" onPress={()=>{management.acknowledge(reviewed);setReviewed([]);setSharedBlocked(false);setMessage('')}}/> : null}
      </Group> : null}
      <Group title="Computer appearance" footer="Shared with the computer; values update after desktop acknowledgement and readback.">
        <Row title="Theme" detail={String(view?.preferences.theme??'deepseek')}><UiHost matchContents><Picker enabled={!sharedPending&&!sharedBlocked&&Boolean(view?.capabilities.actions.includes("set-prefs"))} selectedValue={String(view?.preferences.theme??'deepseek')} onValueChange={theme=>void saveShared({theme:String(theme)})}>{Object.entries(THEMES).map(([id,value])=><Picker.Item key={id} label={value.name} value={id}/>)}</Picker></UiHost></Row>
        <Row title="Accent" detail={String(view?.preferences.accent??'Default')}><View className="flex-row gap-2">{[null,'#3b6fd8','#d97757','#228866'].map(accent=><Button key={accent??'default'} variant="secondary" isDisabled={sharedPending||sharedBlocked||!view?.capabilities.actions.includes('set-prefs')} onPress={()=>void saveShared({accent})}><Button.Label>{accent??'Default'}</Button.Label></Button>)}</View></Row>
        <Row title="Motion"><UiHost matchContents><Picker enabled={!sharedPending&&!sharedBlocked&&Boolean(view?.capabilities.actions.includes("set-prefs"))} selectedValue={String(view?.preferences.motion??'normal')} onValueChange={motion=>void saveShared({motion:motion as 'quiet'|'normal'|'lively'})}>{['quiet','normal','lively'].map(value=><Picker.Item key={value} label={value} value={value}/>)}</Picker></UiHost></Row>
      </Group>
      <Group title="Phone appearance and preferences">
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
              <Picker.Item label="中文" value="zh" />
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
        {view?.capabilities.agents?<Row title="DSH Agent" detail="Owner-granted Agent conversations" onPress={() => router.push("/classic")} />:null}
        {host ? <Row title={tr("Unpair this computer")} destructive onPress={unpair} /> : null}
      </Group>
      <Typography.Paragraph className="text-muted text-center" style={{ fontSize: 12 }}>DeepSeek Bot Pro {Constants.expoConfig?.version} · {locale}</Typography.Paragraph>
    </LargeTitleScrollView>
  );
}

export default function SettingsRoute(){const {host}=useSession();return <Settings key={host?.serverId??"unpaired"}/>;}
