import { ChannelFormScreen } from '@/features/channels/screens/channel-form-screen';
import { CapabilityRoute } from '../src/ds/routes';
export default function Add() { return <CapabilityRoute action="create-room"><ChannelFormScreen create/></CapabilityRoute>; }
