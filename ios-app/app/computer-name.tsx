import React, {useEffect, useRef, useState} from 'react';
import {Stack, useLocalSearchParams, useRouter} from 'expo-router';
import {usePreventRemove} from 'expo-router/react-navigation';
import {Platform, View} from 'react-native';
import {Button, Typography} from 'heroui-native';
import {SheetScrollView} from '@/shared/components/sheet-scroll-view';
import {SheetFormField} from '@/shared/components/sheet-form-field';
import {SheetSaveAction} from '@/shared/components/sheet-save-action';
import {useComputerNames} from '../src/names/ComputerNamesProvider';
import {useSession} from '../src/session/SessionProvider';
import {useI18n} from '../src/i18n';
import {hostKey} from '../src/logic/hosts';
import {normalizeComputerName} from '../src/logic/computer-names';
import type {Host} from '../src/storage';

function NameForm({host}: {host:Host}) {
  const names=useComputerNames(),router=useRouter(),{tr}=useI18n();
  const [value,setValue]=useState(()=>names.name(host)),[initial,setInitial]=useState(value);
  const [ready,setReady]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [finished,setFinished]=useState(false);
  const active=useRef(true),saving=useRef(false);
  usePreventRemove(pending);
  useEffect(()=>{if(finished)router.back()},[finished,router]);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  useEffect(()=>{
    let alive=true;setReady(false);setError('');
    void names.load(host.serverId).then(()=>{if(alive){const current=names.name(host);setValue(current);setInitial(current);setReady(true);}}).catch(()=>{if(alive)setError('Could not read saved computer names. Try again.');});
    return()=>{alive=false};
  },[names.load,names.name,host.serverId,host.slot,retry]);
  let valid=false;try{normalizeComputerName(value);valid=true}catch{}
  const save=async(next:string|null)=>{
    if(!ready||saving.current)return;
    saving.current=true;setPending(true);setError('');
    try{await names.rename(host,next);if(active.current){setPending(false);setFinished(true);}}
    catch(problem){if(active.current)setError(problem instanceof Error?problem.message:'Could not confirm the computer name was saved. Please try again.');}
    finally{saving.current=false;if(active.current)setPending(false);}
  };
  const saveAction=<SheetSaveAction dirty={ready&&value.trim()!==initial} canSave={valid} pending={pending} label={tr('Save name')} pendingLabel={tr('Saving…')} onSave={()=>void save(value)}/>;
  return <SheetScrollView contentContainerClassName="gap-6 px-5 pt-5 pb-8" keyboardShouldPersistTaps="handled">
    {Platform.OS==='web'?<View className="flex-row items-center justify-between gap-3"><Button variant="ghost" isDisabled={pending} onPress={()=>router.back()}><Button.Label>{tr('Cancel')}</Button.Label></Button>{saveAction}</View>:<><Stack.Toolbar placement="left"><Stack.Toolbar.Button disabled={pending} accessibilityLabel={tr('Cancel')} onPress={()=>router.back()}>{tr('Cancel')}</Stack.Toolbar.Button></Stack.Toolbar>{saveAction}</>}
    <SheetFormField label={tr('Computer name')} hint={tr('Use up to 40 characters on one line.')} value={value} onChangeText={setValue} editable={ready&&!pending} maxLength={80} autoCapitalize="none" autoCorrect={false}/>
    <Typography.Paragraph className="text-muted">{tr('Only on this phone. The connection card and computer list use this name.')}</Typography.Paragraph>
    {error?<Typography.Paragraph accessibilityRole="alert" className="text-danger-text">{tr(error)}</Typography.Paragraph>:null}
    {!ready&&error?<Button onPress={()=>setRetry(n=>n+1)}><Button.Label>{tr('Try again')}</Button.Label></Button>:null}
    <Button variant="secondary" isDisabled={!ready||pending} onPress={()=>void save(null)}><Button.Label>{tr('Use computer original name')}</Button.Label></Button>
  </SheetScrollView>;
}
export default function ComputerNameRoute(){
  const params=useLocalSearchParams<{serverId?:string;slot?:string}>(),{hosts}=useSession(),{tr}=useI18n();
  const host=hosts.find(item=>item.serverId===params.serverId&&hostKey(item)===(params.slot??''));
  return host?<NameForm key={JSON.stringify([host.serverId,hostKey(host)])} host={host}/>:<SheetScrollView contentContainerClassName="p-5"><Typography.Paragraph>{tr('Computer is no longer saved.')}</Typography.Paragraph></SheetScrollView>;
}
