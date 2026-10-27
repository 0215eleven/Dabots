import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { Bot } from "../types";
import { readCache, writeCache } from "../storage";
import { createMyLookStore, type MyLook } from "../logic/my-look";
import { useI18n } from "../i18n";
import { BotAvatar } from "./BotAvatar";
import { Button, Notice } from "./UI";

// The phone owner's own avatar: a pixel character (or photo) kept on this
// phone only. It opens Settings from the conversation list.
export type { MyLook } from "../logic/my-look";

const store = createMyLookStore({
  read: () => readCache<MyLook>("app", "myLook", { strict: true }),
  async write(value) {
    await writeCache("app", "myLook", value);
    // Browser preview storage can silently refuse a write; never announce saved
    // until this local key can be read back. No server-scoped key is used.
    return JSON.stringify(await readCache<MyLook>("app", "myLook", { strict: true })) === JSON.stringify(value);
  },
});

function useMyLookState() {
  const [value, setValue] = useState(store.snapshot);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => setValue(store.snapshot()));
    setValue(store.snapshot());
    void store.load();
    return unsubscribe;
  }, []);
  return value;
}

export function useMyLook() {
  return useMyLookState().look;
}

export function updateMyLook(patch: MyLook) {
  return store.update(patch);
}

export function resetMyLook() {
  return store.reset();
}

export function MyLookPersistence() {
  const state = useMyLookState();
  const { tr } = useI18n();
  return <View style={{ gap: 8 }}>
    {state.error === "load" ? <Notice error text={tr("Could not load your saved avatar. Your edits are kept here; retry before saving.")} />
      : state.error === "save" ? <Notice error text={tr("Your avatar was not saved on this phone. Your preview is kept; retry or restore the saved avatar.")} />
      : <Notice text={tr(!state.loaded || state.loading ? "Loading your saved avatar…" : state.saving ? "Saving avatar on this phone…" : "Avatar saved on this phone only.")} />}
    {state.error && <Button secondary title={tr(state.error === "load" ? "Retry loading avatar" : "Retry saving avatar")} disabled={state.saving || state.loading} onPress={() => { void store.retry(); }} />}
    {state.error === "save" && <Button secondary title={tr("Restore saved avatar")} disabled={state.saving} onPress={() => { void store.restore(); }} />}
  </View>;
}

/** The owner as a Bot-shaped record, so the avatar editor and renderer apply as is. */
export const meAsBot = (value: MyLook, name: string): Bot => ({ id: "me", name, color: value.color, avatar: value.avatar } as Bot);

export function MyAvatar({ size, name }: { size: number; name: string }) {
  const value = useMyLook();
  return <BotAvatar bot={meAsBot(value, name)} size={size} />;
}
