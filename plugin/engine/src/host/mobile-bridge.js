import { mobileUpload } from './mobile-attachment.js'
// Mobile contract adapted from this repository's reviewed ds-bot 0.1.7 patch
// for the bundled 0.2.0 engine. Uses only the public DSH Session interface.
export function createMobileBridge(rt, { ok, fail }) {
  const { ctx, state } = rt
  const own = (table, id) => typeof id === 'string' && Object.hasOwn(table, id)
  const stale = () => Object.assign(new Error('Refresh the conversation'), { code: 'bot/stale' })

  function agentTarget(id, sessionId) {
    if (typeof id !== 'string' || !id.startsWith('agent:') || typeof sessionId !== 'string') return undefined
    const agentId = id.slice('agent:'.length)
    const agent = own(state.agents, agentId) ? state.agents[agentId] : undefined
    if (!agent || !Array.isArray(agent.sessions) || !agent.sessions.includes(sessionId)) return undefined
    if (rt.botOf?.(sessionId) !== undefined || rt.selfOf?.(sessionId) !== undefined || rt.roomOf?.(sessionId) !== undefined || rt.groupOwners?.has(sessionId)) return undefined
    return agent
  }

  const files = () => ctx.get?.('fileUploads') ?? ctx.fileUploads
  const images = () => ctx.get?.('attachments') ?? ctx.attachments
  const ownsUpload = body => (own(state.bots, body.conversationId) && rt.chatOf(body.conversationId) === body.expectedSessionId) || agentTarget(body.conversationId, body.expectedSessionId) || (own(state.rooms, body.conversationId) && body.conversationId === body.expectedSessionId)
  return async (endpoint, body, signal) => {
    switch (endpoint) {
      case 'bridge.describe':
        return ok({ version: 1, stableRequestId: true, redactedText: true, groups: true, groupProjection: 1, attachments: typeof files()?.uploadStream === 'function' && typeof images()?.validateImage === 'function' ? 1 : false,
          ...(typeof files()?.uploadStream === 'function' && typeof files()?.resolve === 'function' ? { uploadTransfers:1 } : {}), agents: 1, ...(typeof ctx.sessionController.rename === 'function' ? { agentRename: 1 } : {}) })
      case 'bridge.redact': {
        await rt.loadSecrets()
        const id = body.conversationId
        const room = own(state.rooms, id) ? state.rooms[id] : undefined
        const bot = own(state.bots, id) && rt.chatOf(id) === body.expectedSessionId
        if (!bot && !agentTarget(id, body.expectedSessionId) && !(room && id === body.expectedSessionId && JSON.stringify(body.expectedMembers) === JSON.stringify(room.members))) return fail('Refresh the conversation', 'bot/stale')
        if (!Array.isArray(body.texts) || body.texts.length > 200 || body.texts.some(text => typeof text !== 'string' || text.length > 100000)) return fail('Invalid text batch', 'bot/invalid')
        return ok({ texts: body.texts.map(text => rt.redactSecrets(text)) })
      }
      case 'bridge.submit': {
        if (![1,2].includes(body.version) || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9._:-]{1,256}$/.test(body.requestId)) return fail('Invalid request ID', 'bot/invalid')
        const id = body.conversationId
        if (typeof id !== 'string' || !id || typeof body.expectedSessionId !== 'string') return fail('Invalid conversation', 'bot/invalid')
        if (!Array.isArray(body.content) || !body.content.length || body.content.length > (body.version===2?9:5)) return fail('Invalid content', 'bot/invalid')
        let total = 0, fileCount = 0, texts = 0, previews=0
        try {
          for (const part of body.content) {
            if (part?.type === 'text') {
              if (++texts > 1 || typeof part.text !== 'string' || !part.text.trim() || part.text.length > 100000 || part.text.includes('dsh-session:')) throw Error()
            } else if(body.version===2&&part?.type==='file'){
              if(Object.keys(part).some(key=>!['type','receiptId'].includes(key))||typeof part.receiptId!=='string'||!/^[0-9a-f-]{36}$/.test(part.receiptId))throw Error()
              fileCount++
            }else if(body.version===2){if(part?.type!=='image')throw Error();previews++;total+=mobileUpload(part).length}
            else { fileCount++; total += mobileUpload(part).length }
          }
          if (fileCount > 4 || previews>4 || total > (body.version===2?8:4) * 1024 * 1024) throw Error()
        } catch { return fail('Invalid content', 'bot/invalid') }
        await rt.load()
        const initialRoom = own(state.rooms, id) ? state.rooms[id] : undefined
        const membership = room => JSON.stringify({ members: room.members, admin: room.admin ?? null, mode: room.mode ?? 'admin' })
        const admittedMembership = initialRoom ? membership(initialRoom) : undefined
        const check = () => {
          if (rt.readOnly() !== undefined) throw Object.assign(new Error('Team is read-only'), { code: 'bot/read-only' })
          const room = own(state.rooms, id) ? state.rooms[id] : undefined
          if (initialRoom) {
            if (!room || body.expectedSessionId !== id || JSON.stringify(body.expectedMembers) !== JSON.stringify(room.members)
              || room.members.some(member => !own(state.bots, member)) || membership(room) !== admittedMembership) throw stale()
          } else if (id.startsWith('agent:')) {
            if (!agentTarget(id, body.expectedSessionId)) throw stale()
          } else if (room || !own(state.bots, id) || rt.chatOf(id) !== body.expectedSessionId || rt.groupOwners?.has(body.expectedSessionId)) {
            throw stale()
          }
        }
        check()
        if (id.startsWith('agent:')) await rt.resolveAgent?.(body.expectedSessionId)
        await rt.ensureCapabilities(body.expectedSessionId)
        await rt.refresh()
        check()
        signal.throwIfAborted()
        if(body.version===2){
          const agent=(ctx.get?.('agents')??ctx.agents)?.get(body.expectedSessionId)
          let bytes=0
          for(const part of body.content)if(part.type==='file'){
            const staged=agent&&files()?.resolve?.(agent,part.receiptId)
            // DSH 0.2.2 tags file/image receipts; 0.2.1 returns the file directly.
            // Only unwrap files from this exact Agent's receipt store.
            const file=staged?.type==='file'?staged.attachment:staged?.type===undefined?staged:undefined
            if(!file||!Number.isSafeInteger(file.bytes)||file.bytes<=0||file.bytes>100000000)return fail('Invalid staged file','bot/invalid')
            bytes+=file.bytes
          }
          if(bytes>100000000)return fail('Message originals exceed 100 MB','bot/invalid')
        }
        const content = []
        for (const part of body.content) {
          if (part.type !== 'file-upload') { content.push(part); continue }
          if (!files()?.uploadStream) return fail('File upload unavailable', 'bot/not-found')
          const bytes = mobileUpload(part)
          const uploaded = await files().uploadStream({ sessionId: body.expectedSessionId, name: part.name, data: (async function* () { yield bytes })(), signal })
          content.push({ type: 'file', receiptId: uploaded.receiptId })
        }
        check(); signal.throwIfAborted()
        let result
        try { result = await ctx.sessionController.prompt({ requestId: body.requestId, sessionId: body.expectedSessionId, mode: 'queue', content }, signal) }
        catch (error) { if (error.code === 'session/attachment-invalid') return fail('The model or attachment refused image/file input', 'bot/attachment-invalid'); throw error }
        if (result?.accepted !== true) return fail('Admission is unconfirmed', 'bot/unconfirmed')
        return ok({ accepted: true, requestId: body.requestId, sessionId: body.expectedSessionId })
      }
      case 'bridge.upload-check': {
        await rt.load()
        if (rt.readOnly() !== undefined) return fail('Team is read-only', 'bot/read-only')
        if (!ownsUpload(body)) return fail('Refresh the conversation', 'bot/stale')
        try {
          const bytes = mobileUpload(body.part)
          if (body.part.type === 'image') await images().validateImage({ data: bytes, mediaType: body.part.mediaType, name: body.part.name })
        } catch { return fail('Invalid attachment', 'bot/invalid') }
        if (!ownsUpload(body)) return fail('Refresh the conversation', 'bot/stale')
        signal?.throwIfAborted(); return ok({ accepted: true })
      }
      case 'bridge.agent-open': {
        await rt.load()
        if (rt.readOnly() !== undefined) return fail('Team is read-only', 'bot/read-only')
        const agent = Object.values(state.agents)[0] ?? await rt.addAgent()
        const live = [...agent.sessions].reverse().find(sessionId => agentTarget(`agent:${agent.id}`, sessionId))
        return ok({ agentId: agent.id, sessionId: live ?? await rt.createAgentSession(agent.id) })
      }
      case 'bridge.agent-new': {
        await rt.load()
        if (rt.readOnly() !== undefined) return fail('Team is read-only', 'bot/read-only')
        if (!own(state.agents, body.agentId)) return fail('Refresh the DSH Agent', 'bot/stale')
        return ok({ agentId: body.agentId, sessionId: await rt.createAgentSession(body.agentId) })
      }
      case 'bridge.agent-rename': {
        await rt.load()
        if (rt.readOnly() !== undefined) return fail('Team is read-only', 'bot/read-only')
        if (Object.keys(body).some(key => !['agentId', 'sessionId', 'title'].includes(key)) || typeof body.agentId !== 'string' || typeof body.sessionId !== 'string' || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 80 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(body.title)) return fail('Invalid title', 'bot/invalid')
        if (!agentTarget(`agent:${body.agentId}`, body.sessionId)) return fail('Refresh the DSH Agent', 'bot/stale')
        if (typeof ctx.sessionController.rename !== 'function') return fail('Renaming is unavailable', 'bot/not-found')
        signal?.throwIfAborted()
        // Public DSH command appends a user-owned session/title event and supersedes auto titles.
        return ok(await ctx.sessionController.rename({ sessionId: body.sessionId, title: body.title.trim() }))
      }
    }
  }
}
