import { BRAND_BLUE, contrastText } from "./logic/colors";
export { luminance, contrastText } from "./logic/colors";
import { useMemo, useSyncExternalStore } from "react";
import { Appearance, useColorScheme } from "react-native";

// Base themes follow the host; mobile chat colors are shared across presets.
export const THEMES = {
  deepseek: {
    name: "DeepSeek",
    light: [
      "#ffffff",
      "#fafafa",
      "#f2f2f2",
      "#ffffff",
      "#141414",
      "#070707",
      "#fcfcfc",
      BRAND_BLUE,
    ],
    // Pure black with iOS card greys.
    dark: [
      "#000000",
      "#0b0b0c",
      "#1c1c1e",
      "#1c1c1e",
      "#f5f5f7",
      "#f5f5f7",
      "#000000",
      BRAND_BLUE,
    ],
  },
  mono: {
    name: "Mono",
    light: [
      "#ffffff",
      "#f9f9f9",
      "#f0f0f0",
      "#ffffff",
      "#0d0d0d",
      "#0d0d0d",
      "#ffffff",
      "#0d0d0d",
    ],
    dark: [
      "#000000",
      "#0b0b0c",
      "#1c1c1e",
      "#1c1c1e",
      "#f4f4f4",
      "#f4f4f4",
      "#000000",
      "#f4f4f4",
    ],
  },
  paper: {
    name: "Paper",
    light: [
      "#faf9f5",
      "#f3f0e8",
      "#ebe7dc",
      "#ffffff",
      "#1f1e1b",
      "#2b2a26",
      "#faf9f5",
      "#d97757",
    ],
    dark: [
      "#1f1e1b",
      "#262521",
      "#34322d",
      "#2a2925",
      "#f3f0e8",
      "#f3f0e8",
      "#1f1e1b",
      "#e08a6d",
    ],
  },
  moonlight: {
    name: "Moonlight",
    light: [
      "#f7f9fc",
      "#eef2f8",
      "#e5ebf5",
      "#ffffff",
      "#121826",
      "#1e3a8a",
      "#ffffff",
      BRAND_BLUE,
    ],
    dark: [
      "#0b1020",
      "#10172a",
      "#1a2340",
      "#141c33",
      "#e8edf7",
      "#3b6fd8",
      "#ffffff",
      BRAND_BLUE,
    ],
  },
};
let preferences: Record<string, unknown> = {};
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
export function setThemePreferences(value: Record<string, unknown> = {}) {
  if (
    ["theme", "accent", "motion"].every(
      (key) => value[key] === preferences[key],
    )
  )
    return;
  preferences = value;
  listeners.forEach((callback) => callback());
}
// Light or dark on this phone: follow the system, or force one. Native UI
// (keyboard, alerts, materials) follows through Appearance.setColorScheme.
export type ColorMode = "system" | "dark" | "light";
let colorMode: ColorMode = "system";
const modeListeners = new Set<() => void>();
export function setColorMode(value: ColorMode) {
  if (value === colorMode) return;
  colorMode = value;
  try { Appearance.setColorScheme(value === "system" ? "unspecified" : value); } catch { /* Unsupported host. */ }
  modeListeners.forEach((callback) => callback());
}
export function useColorMode() {
  return useSyncExternalStore(
    (callback) => { modeListeners.add(callback); return () => { modeListeners.delete(callback); }; },
    () => colorMode,
    () => colorMode,
  );
}
function mixHex(hex: string, target: string, amount: number) {
  const channel = (value: string, index: number) => parseInt(value.slice(index, index + 2), 16);
  return "#" + [1, 3, 5].map(index => Math.round(channel(hex, index) * (1 - amount) + channel(target, index) * amount).toString(16).padStart(2, "0")).join("");
}
function alpha(hex: string, opacity: number) {
  return `rgba(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(",")},${opacity})`;
}
export function useTheme() {
  const system = useColorScheme() === "dark";
  const mode = useColorMode();
  const dark = mode === "system" ? system : mode === "dark";
  const prefs = useSyncExternalStore(
    subscribe,
    () => preferences,
    () => preferences,
  );
  // One theme object per (scheme, preferences) keeps memoized children stable.
  return useMemo(() => theme(dark, prefs), [dark, prefs]);
}
function theme(dark: boolean, prefs: Record<string, unknown>) {
  const key =
    typeof prefs.theme === "string" && Object.hasOwn(THEMES,prefs.theme)
      ? (prefs.theme as keyof typeof THEMES)
      : "deepseek";
  const [bg, sidebar, bubble, surface, ink, user, userText, baseAccent] =
    THEMES[key][dark ? "dark" : "light"];
  const accent =
    typeof prefs.accent === "string" && /^#[0-9a-f]{6}$/i.test(prefs.accent)
      ? prefs.accent
      : baseAccent;
  return {
    dark,
    bg,
    sidebar,
    bubble,
    // Your own messages carry the accent (DeepSeek blue by default).
    messageBubble: accent,
    messageText: contrastText(accent),
    surface,
    ink,
    user,
    userText,
    accent,
    link: dark ? "#91aeff" : "#2858b4",
    accentText: contrastText(accent),
    muted: alpha(ink, 0.6),
    faint: alpha(ink, 0.36),
    line: alpha(ink, 0.08),
    lineStrong: alpha(ink, 0.15),
    hover: dark ? "rgba(160,160,160,.12)" : "rgba(119,119,119,.09)",
    active: dark ? "rgba(160,160,160,.2)" : "rgba(119,119,119,.17)",
    soft: alpha(accent, 0.1),
    tagBg: alpha(ink, dark ? 0.09 : 0.06),
    tagInk: alpha(ink, 0.58),
    error: dark ? "#ff7078" : "#c93942",
    // Status only (connected, online), never decoration: iOS system green.
    success: dark ? "#30D158" : "#248A3D",
    // Floating glass chrome: a light veil over the blur, a hairline edge and a soft drop shadow.
    glassFill: dark ? "rgba(30,30,32,0.62)" : "rgba(255,255,255,0.58)",
    glassEdge: dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)",
    glassShadow: dark ? "0px 10px 30px rgba(0,0,0,0.6)" : "0px 10px 30px rgba(15,23,42,0.12)",
    // Dark: the selected tab sits in a recessed, darker well.
    glassLens: dark ? "rgba(0,0,0,0.62)" : alpha(accent, 0.12),
    // Panels ("cards") that group content on the page background.
    card: alpha(ink, dark ? 0.11 : 0.04),
    cardEdge: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)",
    // Bottom sheets lift off a black page in dark mode.
    sheet: dark ? mixHex(bg, "#2a2a2e", 0.55) : bg,
    motion: typeof prefs.motion === "string" ? prefs.motion : "normal",
  };
}
export type Theme = ReturnType<typeof theme>;
