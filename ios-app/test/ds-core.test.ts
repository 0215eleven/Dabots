import test from 'node:test';
import { conversationStreams } from '../src/logic/conversation-streams.ts';
import assert from 'node:assert/strict';
import type { Conversation, MobileClient, Message } from '@ds-bot/mobile-sdk';
import type { TeamState } from '../src/types.ts';
import { createDsCore } from '../src/ds/core.ts';
import { dsId, parseDsId } from '../src/ds/identity.ts';
import { projectTranscript, projectWork } from '../src/ds/projection.ts';
import { createOutbox, type OutboxItem } from '../src/outbox/outbox.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const calls: Array<[
        string,
        Record<string, unknown>
    ]> = [];
    let online = true, active = true, refreshes = 0, failRefresh = false;
    const team: TeamState = {
        bots: [{ id: 'same', name: 'Bot', sessionId: 'session', model: 'dsh/vendor:model', effort: 'deep/custom', instructions: '[redacted]' }, { id: 'b', name: 'B' }],
        rooms: [{ id: 'group', name: 'Group', members: ['same', 'b'] }],
        models: [{ ref: 'dsh/vendor:model', name: 'Actual DSH model' }, { ref: 'dsh/next', name: 'Next' }], defaultModel: 'dsh/vendor:model',
        mobileCapabilities: { send: true, history: true, stream: true, actions: ['update-bot', 'create-bot', 'delete-bot', 'duplicate-bot', 'set-main', 'create-room', 'update-room', 'delete-room', 'set-flags', 'set-prefs', 'efforts'], cancel: true },
    };
    const conversations: Conversation[] = [
        { id: 'same', kind: 'bot', name: 'Bot', sessionId: 'session' },
        { id: 'group', kind: 'room', name: 'Group', sessionId: 'group' },
        { id: 'agent-session', kind: 'agent', name: 'DSH Agent', sessionId: 'other' },
    ];
    let action: (name: string, body: Record<string, unknown>) => Promise<unknown> = async (name, body) => {
        if (name === 'efforts')
            return { efforts: [{ id: 'deep/custom', name: 'Deep' }, { id: 'auto/42', name: 'Automatic' }] };
        if (name === 'update-bot')
            Object.assign(team.bots[0], body, { name: body.name ? 'Canonical name' : team.bots[0].name });
        if (name === 'create-bot') {
            team.bots.push({ id: 'created', name: 'Created' });
            return { id: 'created', created: true };
        }
        if (name === 'delete-bot')
            team.bots = team.bots.filter(b => b.id !== body.id);
        if (name === 'update-room')
            Object.assign(team.rooms[0], body);
        if (name === 'create-room') {
            team.rooms.push({ id: 'new-group', name: 'New', members: ['same', 'b'] });
            return { id: 'new-group', created: true };
        }
        if (name === 'delete-room')
            team.rooms = team.rooms.filter(r => r.id !== body.id);
        if (name === 'set-prefs')
            team.prefs = { ...team.prefs, ...body };
        return { id: body.id, changed: true };
    };
    const messages: Message[] = [{ id: 'm', sessionId: 'session', seq: 1, role: 'assistant', text: 'hello', createdAt: 1, author: { id: 'same', name: 'Bot' } }];
    const client = { action: async (name: string, body: Record<string, unknown>) => { calls.push([name, body]); return action(name, body); }, messages: async () => ({ messages, cursor: null, sessionId: 'session' }), cancel: async () => ({}) } as unknown as MobileClient;
    let snapshot = { serverId: 'host', client, team, conversations, source: 'live' as 'live' | 'cache' };
    let transport = true, pendingReceipt = true;
    let receipt: ((id:string)=>Promise<any>) | undefined;
    let saves: OutboxItem[] = [];
    const outbox = createOutbox({ store: { load: async () => [], save: async (items) => { saves = structuredClone(items); } }, newId: () => 'request-1',
        transport: () => transport ? { deviceId: async () => 'device', target: async () => ({ sessionId: 'session' }), submission: async (id) => receipt ? receipt(id) : ({ requestId: id, status: pendingReceipt ? 'pending' : 'accepted' }), submit: async () => { throw new Error('must recover by receipt'); } } : null,
        setTimer: () => 0, clearTimer: () => { },
    });
    const core = createDsCore({ client, serverId: 'host', getSnapshot: () => snapshot, refresh: async () => { refreshes++; if (failRefresh)
            throw new Error('readback offline'); return snapshot; }, outbox, isOnline: () => online, isCurrent: () => active });
    return { setReceipt: (next:typeof receipt) => {receipt=next;}, core, team, conversations, client, calls, outbox, messages, bot: dsId('host', 'bot', 'same'), group: dsId('host', 'group', 'group'), chat: dsId('host', 'conversation', 'same'),
        failRefresh: () => { failRefresh = true; }, refreshes: () => refreshes, saves: () => saves, setOnline: (v: boolean) => { online = v; }, setActive: (v: boolean) => { active = v; }, setSource: (v: 'live' | 'cache') => { snapshot = { ...snapshot, source: v }; }, switchHost: () => { snapshot = { ...snapshot, serverId: 'elsewhere' }; }, setAction: (v: typeof action) => { action = v; }, accept: () => { pendingReceipt = false; }, pause: () => { transport = false; } };
}
test('identities are stable, lossless, server scoped and distinguish Bots, groups, conversations and Sessions', () => {
    const ids = ['bot', 'group', 'conversation', 'session', 'agent'].map(kind => dsId('host:/雪', kind as 'bot', 'same:/%'));
    assert.equal(new Set(ids).size, 5);
    assert.deepEqual(parseDsId(ids[0]), { serverId: 'host:/雪', kind: 'bot', sourceId: 'same:/%' });
    assert.notEqual(ids[0], dsId('other', 'bot', 'same:/%'));
    assert.throws(() => parseDsId('bot:same'));
});
test('list projections keep Bot, group, conversation and granted DSH Agent sources separate', () => {
    const f = fixture();
    const view = f.core.read();
    assert.equal(view.bots[0].id, f.bot);
    assert.equal(view.bots[0].modelRef, 'dsh/vendor:model');
    assert.equal(view.bots[0].conversationId, f.chat);
    assert.equal(view.bots[0].sessionId, dsId('host', 'session', 'session'));
    assert.equal(view.groups[0].members[0], f.bot);
    assert.equal(view.agents.length, 0);
    f.team.agentAccess = true;
    assert.equal(f.core.read().agents.length, 1);
});
test('attributed transcript preserves source IDs, tool/reasoning details, statuses and group speaker', () => {
    const f = fixture();
    const row = { ...f.messages[0], reasoning: 'thinking', pending: true, tool: { callId: 'call', name: 'read', state: 'running' as const } };
    const [message] = projectTranscript('host', f.conversations[1], [row]);
    assert.equal(message.senderAgentId, f.bot);
    assert.equal(message.status, 'streaming');
    assert.equal(message.ds.source.id, 'm');
    assert.equal(message.ds.reasoning, 'thinking');
    assert.equal(message.ds.tool?.callId, 'call');
    assert.notEqual(message.id, projectTranscript('host', f.conversations[0], [row])[0].id);
});
test('work in a group is not reported as work in the Bot direct chat; approvals are scoped', () => {
    const f = fixture();
    f.team.work = { bots: { same: { roomId: 'group', tool: 'read' } }, rooms: { group: [{ botId: 'same', said: 'Reading' }] }, approvals: [{ id: 'a', botId: 'same', roomId: 'group' }] };
    const work = projectWork('host', f.team);
    assert.equal(work[f.bot]?.phase, 'idle');
    assert.equal(work[f.group].phase, 'waiting');
    assert.equal(work[f.group].members?.[0].botId, f.bot);
});
test('offline/read-only/cache grants refuse writes; unknown actions never reach SDK', async () => {
    const f = fixture();
    f.setOnline(false);
    await assert.rejects(f.core.updateBot(f.bot, { name: 'X' }), { code: 'OFFLINE' });
    f.setOnline(true);
    f.setSource('cache');
    await assert.rejects(f.core.updateBot(f.bot, { name: 'X' }), { code: 'STALE_SNAPSHOT' });
    f.setSource('live');
    f.team.readOnly = 'migration';
    await assert.rejects(f.core.updateBot(f.bot, { name: 'X' }), { code: 'READ_ONLY' });
    f.team.readOnly = null;
    f.team.mobileCapabilities = {};
    await assert.rejects(f.core.updateBot(f.bot, { name: 'X' }), { code: 'UNSUPPORTED' });
    assert.throws(() => f.core.unsupported('provider-config'), { code: 'UNSUPPORTED' });
    assert.equal(f.calls.length, 0);
});
test('writes send original DS IDs and changed fields only, then return canonical readback', async () => {
    const f = fixture();
    const result = await f.core.updateBot(f.bot, { name: 'Requested', instructions: '[redacted]', model: 'dsh/vendor:model', effort: 'deep/custom' });
    assert.deepEqual(f.calls, [['update-bot', { id: 'same', name: 'Requested' }]]);
    assert.equal(result.value.name, 'Canonical name');
    assert.equal(result.status, 'confirmed');
    assert.equal(f.refreshes(), 1);
    await f.core.updateBot(f.bot, { name: 'Canonical name' });
    assert.equal(f.calls.length, 1);
});
test('model and effort choices come from current DSH discovery without fixed provider enums', async () => {
    const f = fixture();
    const choices = await f.core.modelOptions('dsh/vendor:model');
    assert.equal(choices.efforts[1].id, 'auto/42');
    await f.core.updateBot(f.bot, { model: 'dsh/next', effort: 'auto/42' });
    assert.deepEqual(f.calls.at(-1), ['update-bot', { id: 'same', model: 'dsh/next', effort: 'auto/42' }]);
    await assert.rejects(f.core.updateBot(f.bot, { model: 'codex/fake' }), { code: 'INVALID_MODEL' });
    await assert.rejects(f.core.updateBot(f.bot, { effort: 'invented' }), { code: 'INVALID_EFFORT' });
});
test('changed host while validating effort prevents write and stale adapter cannot refresh', async () => {
    const f = fixture();
    f.setAction(async () => { f.switchHost(); return { efforts: [{ id: 'auto/42', name: 'Auto' }] }; });
    await assert.rejects(f.core.updateBot(f.bot, { effort: 'auto/42' }), { code: 'STALE_HOST' });
    assert.equal(f.calls.some(([name]) => name === 'update-bot'), false);
    assert.equal(f.refreshes(), 0);
});
test('same-server replaced client/liveness and disposal invalidate old commands', async () => {
    const f = fixture();
    f.setActive(false);
    await assert.rejects(f.core.updateBot(f.bot, { name: 'X' }), { code: 'STALE_HOST' });
    f.setActive(true);
    f.core.dispose();
    await assert.rejects(f.core.history(f.chat), { code: 'STALE_HOST' });
});
test('canonical refresh is not invoked after host changes during mutation', async () => {
    const f = fixture();
    f.setAction(async () => { f.setActive(false); return { changed: true }; });
    await assert.rejects(f.core.updateBot(f.bot, { name: 'X' }), (error:any) => {assert.equal(error.code, 'READBACK_FAILED'); assert.equal(error.mutation, 'acknowledged'); assert.equal(error.cause.code, 'STALE_HOST'); return true;});
    assert.equal(f.refreshes(), 0);
});
test('CRUD and settings return desktop readback and reject mismatched identity kinds', async () => {
    const f = fixture();
    assert.equal((await f.core.createBot({ name: 'Created' })).value.sourceId, 'created');
    assert.equal((await f.core.createGroup({ members: [f.bot, dsId('host', 'bot', 'b')] })).value.sourceId, 'new-group');
    await f.core.updateGroup(f.group, { name: 'Renamed', members: [f.bot, dsId('host', 'bot', 'b')] });
    assert.deepEqual(f.calls.at(-1), ['update-room', { id: 'group', name: 'Renamed' }]);
    assert.equal((await f.core.setPreferences({ theme: 'dark' })).value.theme, 'dark');
    await f.core.deleteGroup(f.group);
    await f.core.deleteBot(f.bot);
    await assert.rejects(f.core.updateBot(f.chat, { name: 'Wrong' }), { code: 'INVALID_ID' });
});
test('history uses actual conversation IDs, not underlying session IDs', async () => {
    const f = fixture();
    let called = '';
    f.client.messages = async (id) => { called = id; return { messages: f.messages, cursor: 'next', sessionId: 'session' }; };
    const page = await f.core.history(f.chat);
    assert.equal(called, 'same');
    assert.equal(page.cursor, 'next');
    assert.equal(page.sessionId, dsId('host', 'session', 'session'));
    await assert.rejects(f.core.history(dsId('host', 'session', 'session')), { code: 'INVALID_ID' });
});
test('enqueue is pending, not accepted; receipt recovery keeps durable request ID and refreshes', async () => {
    const f = fixture();
    const sent = await f.core.send(f.chat, { text: ' hello ' });
    assert.notEqual(sent?.state, 'accepted');
    assert.equal(sent?.requestId, 'request-1');
    await tick();
    assert.equal(f.core.pending(f.chat)[0].state, 'unconfirmed');
    assert.equal(f.saves()[0].requestId, 'request-1');
    f.accept();
    await f.core.retrySend('request-1');
    await tick();
    await tick();
    assert.equal(f.core.pending(f.chat)[0].state, 'accepted');
    assert.ok(f.refreshes() > 0);
    f.messages[0] = { ...f.messages[0], role: 'user', requestId: 'request-1' };
    await f.core.history(f.chat);
    assert.equal(f.core.pending(f.chat).length, 0);
    f.core.dispose();
    f.outbox.dispose();
});
test('host send/history/stream grants and attachment grants fail closed independently', async () => {
    const f = fixture();
    let reads = 0;
    f.client.messages = async () => { reads++; return { messages: [], cursor: null, sessionId: 'session' }; };
    f.team.mobileCapabilities = { actions: ['update-bot'] };
    assert.equal(f.core.capabilities().send, false);
    await assert.rejects(f.core.send(f.chat, { text: 'blocked' }), { code: 'UNSUPPORTED' });
    await assert.rejects(f.core.history(f.chat), { code: 'UNSUPPORTED' });
    assert.throws(() => f.core.watchConversation(f.chat, { onSnapshot() { } }), { code: 'UNSUPPORTED' });
    f.team.mobileCapabilities.send = true;
    await assert.rejects(f.core.send(f.chat, { text: 'image', attachments: [{ name: 'x', type: 'image' }] }), { code: 'UNSUPPORTED' });
    assert.equal(reads, 0);
    assert.equal(f.outbox.list().length, 0);
    f.core.dispose();
    f.outbox.dispose();
});
test('acknowledged create with failed readback is distinguishable from refusal and is never retried', async () => {
    const f = fixture();
    f.failRefresh();
    await assert.rejects(f.core.createBot({ name: 'Created' }), (error: unknown) => {
        assert.equal((error as any).code, 'READBACK_FAILED');
        assert.equal((error as any).mutation, 'acknowledged');
        assert.equal((error as any).acknowledgement.id, 'created');
        return true;
    });
    assert.equal(f.calls.filter(([name]) => name === 'create-bot').length, 1);
});
test('an unknown mutation transport result warns against blind retry', async () => {
    const f = fixture();
    f.setAction(async () => { throw new Error('connection lost'); });
    await assert.rejects(f.core.createBot({ name: 'Maybe created' }), { code: 'MUTATION_UNCONFIRMED', mutation: 'unknown' });
    assert.equal(f.calls.length, 1);
});
test('a late history response from a switched host never returns transcript or settles its outbox', async () => {
    const f = fixture();
    f.client.messages = async () => { f.switchHost(); return { messages: f.messages, cursor: null, sessionId: 'session' }; };
    await assert.rejects(f.core.history(f.chat), { code: 'STALE_HOST' });
});
test('explicit owner identity never guesses conversation ID from a Bot or underlying Session', async () => {
    const f = fixture();
    f.conversations[0] = { ...f.conversations[0], id: 'actual-chat', botId: 'same' };
    assert.equal(f.core.read().bots[0].conversationId, dsId('host', 'conversation', 'actual-chat'));
    const sent = await f.core.send(dsId('host', 'conversation', 'actual-chat'), { text: 'hello' });
    assert.equal(sent?.conversationId, dsId('host', 'conversation', 'actual-chat'));
    await tick();
    f.core.dispose();
    f.outbox.dispose();
});
test('stream projection uses the existing pool and disposal detaches without moving lifecycle ownership', async () => {
    const f = fixture();
    let options: any;
    let rows: any[] = [];
    f.client.connect = (input: any) => { options = input; return { close() { }, reconnectNow() { }, cursor: null }; };
    const stop = f.core.watchConversation(f.chat, { onSnapshot: s => { rows = s.messages; } });
    assert.equal(options.conversationId, 'same');
    options.onEvent({ type: 'message', message: f.messages[0] });
    assert.equal(rows.at(-1).ds.source.id, 'm');
    f.core.dispose();
    rows = [];
    options.onEvent({ type: 'message', message: { ...f.messages[0], id: 'late' } });
    assert.equal(rows.length, 0);
    stop();
    conversationStreams.clear(f.client);
});
test('changing the Bot model during effort validation refuses the stale selection', async () => {
    const f = fixture();
    f.setAction(async () => { f.team.bots[0].model = 'dsh/next'; return { efforts: [{ id: 'auto/42', name: 'Auto' }] }; });
    await assert.rejects(f.core.updateBot(f.bot, { effort: 'auto/42' }), { code: 'STALE_SNAPSHOT' });
    assert.equal(f.calls.some(([name]) => name === 'update-bot'), false);
});

test('DSH Agent transcript attribution never reuses the Bot namespace',()=>{
  const f=fixture();const chat={...f.conversations[2],agentId:'same'};
  const [message]=projectTranscript('host',chat,f.messages);
  assert.equal(message.senderAgentId,dsId('host','agent','same'));assert.notEqual(message.senderAgentId,f.bot);
});

test('canonical streaming transcript settles an accepted durable send',async()=>{
  const f=fixture();let options:any;
  f.client.connect=(input:any)=>{options=input;return {close(){},reconnectNow(){},cursor:null};};
  f.accept();await f.core.send(f.chat,{text:'hello'});await tick();
  assert.equal(f.core.pending(f.chat)[0].state,'accepted');f.core.watchConversation(f.chat,{onSnapshot(){}});
  options.onEvent({type:'message',message:{...f.messages[0],role:'user',requestId:'request-1'}});await tick();
  assert.equal(f.core.pending(f.chat).length,0);f.core.dispose();conversationStreams.clear(f.client);
});

test('a model change validates an explicitly unchanged effort before filtering the write fields',async()=>{
  const f=fixture();f.setAction(async()=>({efforts:[{id:'new-only',name:'New only'}]}));
  await assert.rejects(f.core.updateBot(f.bot,{model:'dsh/next',effort:'deep/custom'}),{code:'INVALID_EFFORT'});
  assert.deepEqual(f.calls,[['efforts',{ref:'dsh/next'}]]);
});

test('a model change validates the retained effort even when the selection omits it',async()=>{
  const f=fixture();f.setAction(async()=>({efforts:[{id:'new-only',name:'New only'}]}));
  await assert.rejects(f.core.updateBot(f.bot,{model:'dsh/next'}),{code:'INVALID_EFFORT'});
  assert.equal(f.calls.some(([name])=>name==='update-bot'),false);
});

test('a compatible unchanged effort is validated without echoing the unchanged field',async()=>{
  const f=fixture();await f.core.updateBot(f.bot,{model:'dsh/next',effort:'deep/custom'});
  assert.deepEqual(f.calls,[['efforts',{ref:'dsh/next'}],['update-bot',{id:'same',model:'dsh/next'}]]);
});

test('cached Agent history refuses a grant revoked while the cache read is pending',async()=>{
  const f=fixture();f.team.agentAccess=true;
  f.client.getCachedMessages=async()=>{f.team.agentAccess=false;return f.messages;};
  await assert.rejects(f.core.cachedHistory(dsId('host','conversation','agent-session')),{code:'UNSUPPORTED'});
});

test('cached history rechecks visibility after its read and keeps ordinary offline Bot/group access',async()=>{
  const f=fixture();f.client.getCachedMessages=async()=>f.messages;f.setOnline(false);f.setSource('cache');
  assert.equal((await f.core.cachedHistory(f.chat))[0].text,'hello');
  assert.equal((await f.core.cachedHistory(dsId('host','conversation','group')))[0].text,'hello');
  f.client.getCachedMessages=async()=>{f.conversations.splice(0,1);return f.messages;};
  await assert.rejects(f.core.cachedHistory(f.chat),{code:'NOT_FOUND'});
});

test('acknowledged cancellation retains its receipt when canonical readback fails',async()=>{
  const f=fixture();const receipt={cancelled:true};let cancels=0;
  f.client.cancel=async()=>{cancels++;return receipt;};f.failRefresh();
  await assert.rejects(f.core.cancel(f.chat),(error:any)=>{
    assert.equal(error.code,'READBACK_FAILED');assert.equal(error.mutation,'acknowledged');assert.equal(error.acknowledgement,receipt);return true;
  });assert.equal(cancels,1);
});

test('a lost cancellation reply is unknown, a definite refusal stays refused, and neither auto-retries',async()=>{
  const f=fixture();let cancels=0;
  f.client.cancel=async()=>{cancels++;throw new Error('reply lost');};
  await assert.rejects(f.core.cancel(f.chat),{code:'MUTATION_UNCONFIRMED',mutation:'unknown'});
  assert.equal(cancels,1);assert.equal(f.refreshes(),0);
  const refusal=Object.assign(new Error('denied'),{status:403});f.client.cancel=async()=>{throw refusal;};
  await assert.rejects(f.core.cancel(f.chat),error=>error===refusal);
});

test('cancellation readback respects old-host liveness and preserves its successful return shape',async()=>{
  const f=fixture();f.client.cancel=async()=>({cancelled:true});
  assert.deepEqual(await f.core.cancel(f.chat),{cancelled:true});assert.equal(f.refreshes(),1);
  f.client.cancel=async()=>{f.setActive(false);return {cancelled:true};};
  await assert.rejects(f.core.cancel(f.chat),(error:any)=>{assert.equal(error.code,'READBACK_FAILED');assert.equal(error.mutation,'acknowledged');assert.deepEqual(error.acknowledgement,{cancelled:true});assert.equal(error.cause.code,'STALE_HOST');return true;});assert.equal(f.refreshes(),1);
});

test('Agent history rechecks its grant after asynchronous outbox settlement',async()=>{
  const f=fixture();f.team.agentAccess=true;f.outbox.settle=async()=>{f.team.agentAccess=false;};
  await assert.rejects(f.core.history(dsId('host','conversation','agent-session')),{code:'UNSUPPORTED'});
});

test('a model-only write refuses a retained effort changed during option discovery',async()=>{
  const f=fixture();f.setAction(async()=>{f.team.bots[0].effort='changed-at-host';return {efforts:[{id:'deep/custom',name:'Deep'}]};});
  await assert.rejects(f.core.updateBot(f.bot,{model:'dsh/next'}),{code:'STALE_SNAPSHOT'});
  assert.equal(f.calls.some(([name])=>name==='update-bot'),false);
});

test('a default-model change during reasoning discovery invalidates the selection',async()=>{
  const f=fixture();f.setAction(async()=>{f.team.defaultModel='dsh/next';return {efforts:[{id:'auto/42',name:'Auto'}]};});
  await assert.rejects(f.core.updateBot(f.bot,{model:null,effort:'auto/42'}),{code:'STALE_SNAPSHOT'});
  assert.equal(f.calls.some(([name])=>name==='update-bot'),false);
});

test('canonical stream before accepted receipt automatically settles pending without another stream or history update',async()=>{
 const f=fixture();let stream:any,resolveReceipt:any,snapshots=0,historyCalls=0;
 f.setReceipt(()=>new Promise(resolve=>{resolveReceipt=resolve;}));
 f.client.messages=async()=>{historyCalls++;throw Error('no history refresh is required');};
 f.client.connect=(input:any)=>{stream=input;return {close(){},reconnectNow(){throw Error('no reconnect is required');},cursor:null};};
 try {
  f.core.watchConversation(f.chat,{onSnapshot(){snapshots++;}});
  await f.core.send(f.chat,{text:'canonical first'});await tick();assert.equal(f.core.pending(f.chat)[0].state,'sending');
  stream.onEvent({type:'message',message:{...f.messages[0],role:'user',text:'canonical first',requestId:'request-1'}});await tick();
  const before=snapshots;assert.equal(f.core.pending(f.chat).length,1,'canonical evidence alone must not imply receipt acceptance');
  resolveReceipt({requestId:'request-1',conversationId:'same',sessionId:'session',status:'accepted'});await tick();await tick();
  assert.deepEqual(f.core.pending(f.chat),[]);assert.deepEqual(f.saves(),[]);assert.equal(snapshots,before);assert.equal(historyCalls,0);
 }finally{f.core.dispose();f.outbox.dispose();conversationStreams.clear(f.client);}
});
