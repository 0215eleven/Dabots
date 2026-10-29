import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// Light, system-standard feedback. Failures (simulator, web, disabled) are silent.
const enabled = Platform.OS === "ios" || Platform.OS === "android";
export function selectionFeedback() {
  if (enabled) void Haptics.selectionAsync().catch(() => {});
}
export function tapFeedback() {
  if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
export function successFeedback() {
  if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
export function errorFeedback() {
  if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
