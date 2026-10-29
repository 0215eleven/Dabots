import { Redirect } from 'expo-router';
import { ConnectedScreen } from '@/features/agents/screens/connected-screen';
import { useSession } from '../src/session/SessionProvider';
export default function Index() { const { loading, host } = useSession(); if (!loading && !host)
    return <Redirect href="/pairing"/>; return <ConnectedScreen />; }
