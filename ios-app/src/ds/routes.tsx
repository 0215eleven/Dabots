import { useDsText } from '@ds/text';
import React from 'react';
import { View } from 'react-native';
import { Button, Typography } from 'heroui-native';
import { router } from 'expo-router';
import { useDs } from './provider';
export function Unavailable() {
    const { tr } = useDsText(); return <View className="flex-1 items-center justify-center gap-4 bg-background px-6"><Typography.Heading type="h4">{tr("Unavailable on this computer")}</Typography.Heading><Typography.Paragraph>{tr("This page or conversation is not supported by the selected computer, or access has changed.")}</Typography.Paragraph><Button onPress={() => router.replace('/')}><Button.Label>{tr("Return to chats")}</Button.Label></Button></View>; }
export function CapabilityRoute({ action, children }: {
    action: string;
    children: React.ReactNode;
}) { const { view } = useDs(); return view?.capabilities.actions.includes(action) ? children : <Unavailable />; }
