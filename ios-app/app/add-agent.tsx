import { AddAgentScreen } from '@/features/agents/screens/add-agent-screen';
import { CapabilityRoute } from '../src/ds/routes';
export default function Add() { return <CapabilityRoute action="create-bot"><AddAgentScreen /></CapabilityRoute>; }
