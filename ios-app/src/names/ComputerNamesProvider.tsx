import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {computerName, createComputerNameStore, type ComputerNameSnapshot} from '../logic/computer-names';
import {hostKey} from '../logic/hosts';
import {readCache, writeCache, type Host} from '../storage';
import {useSession} from '../session/SessionProvider';

interface ComputerNames {
  name(host: Host | null | undefined): string;
  load(serverId: string): Promise<void>;
  rename(host: Host, value: string | null): Promise<void>;
  snapshot: ComputerNameSnapshot;
  error: string;
}
const Context = createContext<ComputerNames | null>(null);
export function useComputerNames(): ComputerNames {
  const value = useContext(Context);
  if (!value) throw Error('Computer names are unavailable outside their provider.');
  return value;
}

/** Separate from SessionProvider so editing a label cannot recreate its client/outbox. */
export function ComputerNamesProvider({children}: {children: React.ReactNode}) {
  const {hosts} = useSession();
  const current = useRef(hosts);current.current = hosts;
  const previous = useRef(new Set<string>());
  const [errors, setErrors] = useState(()=>new Map<string,string>());
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  const report=useCallback((id:string,message:string)=>{
    if(!mounted.current)return;
    setErrors(previous=>{if((previous.get(id)??'')===message)return previous;const next=new Map(previous);if(message)next.set(id,message);else next.delete(id);return next});
  },[]);
  const store = useMemo(() => createComputerNameStore({
    // A transcript-cache refresh must not erase this phone's display preferences.
    read: (id, key) => readCache('app', `${key}:${id}`, {strict: true}),
    write: (id, key, value) => writeCache('app', `${key}:${id}`, value),
  }), []);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const load=useCallback(async(id:string)=>{
    try{await store.load(id);report(id,'');}
    catch{report(id,'Could not read saved computer names. Try again.');throw Error('Could not read saved computer names. Try again.');}
  },[store,report]);
  useEffect(() => {
    const ids = new Set(hosts.map(host => host.serverId));
    for (const id of ids) void load(id).catch(() => {});
    // A queued rename that started before removal finishes before this reset.
    for (const id of previous.current) if (!ids.has(id)) void store.forget(id).then(()=>report(id,''),()=>report(id,'Could not confirm the computer name was saved. Please try again.'));
    previous.current = ids;
  }, [hosts, store, load, report]);
  const name = useCallback((host: Host | null | undefined) => computerName(host, store.getSnapshot()), [store]);
  const rename = useCallback(async (host: Host, value: string | null) => {
    const saved = () => current.current.some(item => item.serverId === host.serverId && hostKey(item) === hostKey(host));
    if (!saved()) throw Error('Computer is no longer saved.');
    await store.rename(host.serverId, value);
    if (!saved()) throw Error('Computer is no longer saved.');
    report(host.serverId,'');
  }, [store,report]);
  const error=errors.values().next().value??'';
  const value = useMemo(() => ({name, load, rename, error, snapshot}), [name, load, rename, error, snapshot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
