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

  return async (endpoint, body, signal) => {
    switch (endpoint) {
      case 'bridge.describe':
        return ok({ version: 1, stableRequestId: true, redactedText: true, groups: true, groupProjection: 1, attachments: false, agents: 1 })
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
        if (body.version !== 1 || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9._:-]{1,256}$/.test(body.requestId)) return fail('Invalid request ID', 'bot/invalid')
        const id = body.conversationId
        if (typeof id !== 'string' || !id || typeof body.expectedSessionId !== 'string') return fail('Invalid conversation', 'bot/invalid')
        if (!Array.isArray(body.content) || body.content.length !== 1 || body.content[0]?.type !== 'text' || typeof body.content[0].text !== 'string' || !body.content[0].text.trim() || body.content[0].text.length > 100000 || body.content[0].text.includes('dsh-session:')) return fail('Plain text required', 'bot/invalid')
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
        const result = await ctx.sessionController.prompt({ requestId: body.requestId, sessionId: body.expectedSessionId, mode: 'queue', content: body.content }, signal)
        if (result?.accepted !== true) return fail('Admission is unconfirmed', 'bot/unconfirmed')
        return ok({ accepted: true, requestId: body.requestId, sessionId: body.expectedSessionId })
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
    }
  }
}
