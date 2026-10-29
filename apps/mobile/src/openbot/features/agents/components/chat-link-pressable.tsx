// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import type { ComponentProps } from "react";
import { Pressable } from "react-native";

export function ChatLinkPressable(props: ComponentProps<typeof Pressable>) {
  return <Pressable {...props} />;
}
