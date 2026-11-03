import test from 'node:test';
import assert from 'node:assert/strict';
import { findAgentConversation } from '../src/ds/agent-route.ts';
import { dsId } from '../src/ds/identity.ts';

test('an Agent conversation is found whether the router decodes its ID or not', () => {
  const sourceId = 'agent:a1:s9';
  const agent = { id: dsId('srv-1', 'conversation', sourceId), sourceId } as any;
  assert.ok(agent.id.includes('%3A'), 'the DS ID percent-encodes the colons');
  assert.equal(findAgentConversation([agent], agent.id), agent);
  assert.equal(findAgentConversation([agent], decodeURIComponent(agent.id)), agent, 'a decoded route parameter still matches');
  assert.equal(findAgentConversation([agent], encodeURIComponent(agent.id)), agent, 'an ID encoded once more still matches');
  assert.equal(findAgentConversation([agent], sourceId), agent);
  assert.equal(findAgentConversation([agent], dsId('srv-1', 'conversation', 'agent:a1:other')), undefined);
  assert.equal(findAgentConversation(undefined, agent.id), undefined);
  assert.equal(findAgentConversation([agent], '%E0%A4%A'), undefined, 'a malformed parameter does not throw');
});
