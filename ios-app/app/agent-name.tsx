import React,{useEffect,useRef,useState} from 'react';
import {Stack,useLocalSearchParams,useRouter} from 'expo-router';
import {usePreventRemove} from 'expo-router/react-navigation';
import {Platform,View} from 'react-native';
import {Button,Typography} from 'heroui-native';
import type {Conversation} from '@ds-bot/mobile-sdk';
import {SheetScrollView} from '@/shared/components/sheet-scroll-view';
import {SheetFormField} from '@/shared/components/sheet-form-field';
import {SheetSaveAction} from '@/shared/components/sheet-save-action';
import {useSession} from '../src/session/SessionProvider';
import {useDs} from '../src/ds/provider';
import {findAgentConversation} from '../src/ds/agent-route';
import {useI18n} from '../src/i18n';
import {normalizeAgentTitle,renameAgentTitle} from '../src/logic/agent-title';

export function AgentNameForm({conversation}:{conversation:Conversation}){
 const {client,workspace}=useSession(),router=useRouter(),{tr}=useI18n();
 const [value,setValue]=useState(conversation.name),[pending,setPending]=useState(false),[error,setError]=useState(''),[finished,setFinished]=useState(false);
 const active=useRef(true),saving=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 usePreventRemove(pending);
 useEffect(()=>{if(finished)router.back()},[finished,router]);
 let valid=false;try{normalizeAgentTitle(value);valid=true}catch{}
 const save=async()=>{
  if(!client||saving.current||!valid||!workspace.online||workspace.team.readOnly)return;
  saving.current=true;setPending(true);setError('');
  try{await renameAgentTitle(client,conversation,value);await workspace.refresh({fresh:true});if(active.current){setPending(false);setFinished(true)}}
  catch(problem){if(active.current)setError(problem instanceof Error?problem.message:'Could not confirm the conversation name was saved. Please try again.')}
  finally{saving.current=false;if(active.current)setPending(false)}
 };
 const action=<SheetSaveAction dirty={value.trim()!==conversation.name} canSave={valid&&workspace.online&&!workspace.team.readOnly} pending={pending} label={tr('Save name')} pendingLabel={tr('Saving…')} onSave={()=>void save()}/>;
 return <SheetScrollView contentContainerClassName="gap-6 px-5 pt-5 pb-8" keyboardShouldPersistTaps="handled">
  {Platform.OS==='web'?<View className="flex-row items-center justify-between gap-3"><Button variant="ghost" isDisabled={pending} onPress={()=>router.back()}><Button.Label>{tr('Cancel')}</Button.Label></Button>{action}</View>:<><Stack.Toolbar placement="left"><Stack.Toolbar.Button disabled={pending} onPress={()=>router.back()}>{tr('Cancel')}</Stack.Toolbar.Button></Stack.Toolbar>{action}</>}
  <SheetFormField label={tr('Conversation name')} hint={tr('Use up to 80 characters on one line.')} value={value} onChangeText={setValue} editable={!pending} maxLength={80} autoCorrect={false}/>
  {error?<Typography.Paragraph accessibilityRole="alert" className="text-danger-text">{tr(error)}</Typography.Paragraph>:null}
 </SheetScrollView>;
}
export default function AgentName(){
 const {id}=useLocalSearchParams<{id:string}>(),{view}=useDs(),{workspace}=useSession(),{tr}=useI18n();
 const granted=findAgentConversation(view?.agents,id),conversation=granted&&workspace.conversations.find(c=>c.id===granted.sourceId&&c.kind==='agent');
 const actions=workspace.team.mobileCapabilities?.actions;
 return conversation&&Array.isArray(actions)&&actions.includes('agent-rename')?<AgentNameForm key={granted.id} conversation={conversation}/>:<SheetScrollView contentContainerClassName="p-5"><Typography.Paragraph>{tr('This Agent conversation is no longer available.')}</Typography.Paragraph></SheetScrollView>;
}
