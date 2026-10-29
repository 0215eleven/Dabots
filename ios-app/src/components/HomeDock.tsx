import React from 'react';
import { Keyboard, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EdgeFade, Glass } from './Glass';
import { AnimatedPressable as Pressable } from './Motion';
import { MyAvatar } from './MyAvatar';
import { DOCK_HEIGHT, Icon, dockBottom } from './UI';
import { useTheme } from '../theme';
import { useI18n } from '../i18n';

// The bottom of the conversation list: your avatar (every other entry lives
// behind it, in Settings) on the left, search filling
// the rest. It rides up with the keyboard while searching.
export function HomeDock({ query, onQuery, onSettings }: {
  query: string;
  onQuery: (value: string) => void;
  onSettings: () => void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const bottom = dockBottom(useSafeAreaInsets().bottom);
  return (
    <KeyboardStickyView offset={{ opened: bottom - 8 }} pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      {/* Rows scrolling under the dock fade out rather than meet a hard edge. */}
      <EdgeFade edge="bottom" height={bottom + DOCK_HEIGHT + 24} />
      <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: bottom, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Glass radius={DOCK_HEIGHT / 2}>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('Settings')} onPress={() => { Keyboard.dismiss(); onSettings(); }}
            style={({ pressed }) => ({ width: DOCK_HEIGHT, height: DOCK_HEIGHT, borderRadius: DOCK_HEIGHT / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.hover : undefined })}>
            <MyAvatar size={38} name={tr('Me')} />
          </Pressable>
        </Glass>
        <Glass radius={DOCK_HEIGHT / 2} style={{ flex: 1, height: DOCK_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18 }}>
          <Icon name="search" size={20} color={t.muted} />
          {/* A view of its own keeps the field above the glass material on the web. */}
          <View style={{ flex: 1 }}>
            <TextInput accessibilityLabel={tr('Search conversations')} placeholder={tr('Search conversations')} placeholderTextColor={t.muted}
              value={query} onChangeText={onQuery} returnKeyType="search" clearButtonMode="while-editing"
              style={{ color: t.ink, fontSize: 17, height: DOCK_HEIGHT }} />
          </View>
        </Glass>
      </View>
    </KeyboardStickyView>
  );
}
