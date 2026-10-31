import { tr } from "../i18n";
import React, { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, AppState, Easing, Image, Platform, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import data from "./characterData.json";
import pixelCharacters from "./pixelCharacters.json";
import { Bot, Room, TeamState } from "../types";
import { useTheme } from "../theme";
import { BRAND_BLUE, luminance } from "../logic/colors";
import { useReducedMotion } from "./Motion";
import { useScreenActivity } from "./ScreenActivity";

// One app-state listener shared by every avatar instead of one per avatar.
let appActive = AppState.currentState === "active";
const appListeners = new Set<() => void>();
let appSubscription: { remove(): void } | null = null;
function subscribeAppState(listener: () => void) {
  appListeners.add(listener);
  if (!appSubscription) {
    appActive = AppState.currentState === "active";
    appSubscription = AppState.addEventListener("change", state => {
      appActive = state === "active";
      appListeners.forEach(notify => notify());
    });
  }
  return () => {
    appListeners.delete(listener);
    if (!appListeners.size) { appSubscription?.remove(); appSubscription = null; }
  };
}
const useAppActive = () => useSyncExternalStore(subscribeAppState, () => appActive, () => appActive);
// Small avatars (group members, message authors) stay still; blinking redraws the whole SVG.
const BLINK_MIN_SIZE = 32;

// Character slots come from DS Bot's original characters (ds-bot/src/client/characters.js);
// the artwork drawn for each slot is the pixel set in pixelCharacters.json.
type Character = {
  body: string;
  shade: string;
  light: string;
  eyes: number[][];
  paints?: (string | number)[][];
  label?: string;
};
// Same slots as the stored avatar shapes; names follow the pixel characters.
export const characters = Object.fromEntries(Object.entries(data.characters as Record<string, Character>).map(([shape, character]) =>
  [shape, { ...character, label: (pixelCharacters.characters as Record<string, { label?: string }>)[shape]?.label || character.label }])) as Record<string, Character>;
export const characterShapes = data.shapes;
export const characterColors = data.colors;
export const inks = data.inks as Record<string, string[]>;
export const mainLook = {
  id: "ds-bot",
  name: "Dabots",
  color: BRAND_BLUE,
  avatar: { shape: "whale" },
};
function hash(id: string) {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++)
    value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return value >>> 0;
}
export function defaultColor(id: string) {
  const t = (hash(id) + 1831565813) | 0;
  let n = Math.imul(t ^ (t >>> 15), 1 | t);
  n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
  return data.defaultColors[
    Math.floor(
      (((n ^ (n >>> 14)) >>> 0) / 4294967296) * data.defaultColors.length,
    )
  ];
}
export function defaultShape(id: string) {
  let value = hash(id) | 0;
  value = Math.imul(value ^ (value >>> 16), 73244475);
  value = Math.imul(value ^ (value >>> 13), 3266489909);
  return data.defaultShapes[
    ((value ^ (value >>> 16)) >>> 0) % data.defaultShapes.length
  ];
}
export function botColor(bot: Pick<Bot, "id" | "color">, dark = false) {
  const key = bot.color || defaultColor(bot.id);
  return /^#[0-9a-f]{6}$/i.test(key)
    ? key
    : (inks[key] || inks.gray)[dark ? 1 : 0];
}
// Hand-drawn pixel characters (scripts/pixel-characters.mjs): the body takes
// the Bot's colour; tone layers give it volume; accessories keep their colours.
type Source = { rows: string[]; eyes: number[][][]; shine: number[][]; closed: number[][][]; paints: (string | number)[][]; eyeFill?: string };
type Sprite = {
  size: number; fill: string; outline: string; litOutline: string;
  tones: { d: string; fill: string; opacity: number }[];
  paints: { d: string; fill: string; opacity: number }[];
  eyes: (look: number) => string; shine: (look: number) => string; closed: (look: number) => string; eyeFill?: string;
};
// Shadows lean cool and light leans warm, so any body colour reads as lit.
const TONES = [["d", "#140c38", 0.36], ["s", "#1c1448", 0.18], ["l", "#fff2d6", 0.24], ["h", "#ffffff", 0.75]] as const;
const sprites = new Map<string, Sprite>();
function runs(rows: string[], match: (cell: string) => boolean) {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (!match(row[x])) { x++; continue; }
      let end = x;
      while (end < row.length && match(row[end])) end++;
      d += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  });
  return d;
}
const cells = (list: number[][], dx = 0) => list.map(([x, y]) => `M${x + dx} ${y}h1v1h-1z`).join("");
// Eye paths for each glance direction (-1, 0, 1), built once per character.
function glances(build: (dx: number) => string) {
  const paths = [-1, 0, 1].map(build);
  return (look: number) => paths[Math.max(-1, Math.min(1, look)) + 1];
}
function sprite(shape: string) {
  let value = sprites.get(shape);
  if (value) return value;
  const all = pixelCharacters.characters as Record<string, Source>;
  const source = all[shape] || all.gumdrop;
  const { rows } = source;
  value = {
    size: pixelCharacters.size,
    fill: runs(rows, cell => !".op".includes(cell)),
    outline: runs(rows, cell => cell !== "."),
    litOutline: runs(rows, cell => cell === "p"),
    tones: TONES.map(([code, fill, opacity]) => ({ d: runs(rows, cell => cell === code), fill, opacity })),
    paints: source.paints.map(([fill, opacity], index) => ({ d: runs(rows, cell => cell === String(index)), fill: String(fill), opacity: Number(opacity) })),
    eyes: glances(dx => source.eyes.map(eye => cells(eye, dx)).join("")),
    shine: glances(dx => cells(source.shine, dx)),
    closed: glances(dx => source.closed.map(eye => cells(eye, dx)).join("")),
    eyeFill: source.eyeFill,
  };
  sprites.set(shape, value);
  return value;
}
function mix(hex: string, target: string, amount: number) {
  const channel = (value: string, index: number) => parseInt(value.slice(index, index + 2), 16);
  return "#" + [1, 3, 5].map(index => Math.round(channel(hex, index) * (1 - amount) + channel(target, index) * amount).toString(16).padStart(2, "0")).join("");
}

export const BotAvatar = memo(function BotAvatar({
  bot,
  size = 36,
  main = false,
  admin = false,
  live = false,
  silhouette = false,
  blink: controlledBlink,
  animate = true,
  eyeFill,
}: {
  bot: Pick<Bot, "id" | "name" | "color" | "avatar">;
  size?: number;
  main?: boolean;
  admin?: boolean;
  live?: boolean;
  silhouette?: boolean;
  blink?: boolean;
  animate?: boolean;
  eyeFill?: string;
}) {
  const t = useTheme();
  const shape = characters[bot.avatar?.shape || ""] ? bot.avatar!.shape! : bot.id ? defaultShape(bot.id) : "gumdrop";
  const photo = bot.avatar?.image;
  const appVisible = useAppActive();
  const screenActive = useScreenActivity();
  // Hidden pages keep their avatars mounted; only the visible page blinks.
  const foreground = appVisible && screenActive;
  const reduceMotion = useReducedMotion();
  const [autoBlink, setBlink] = useState(false);
  const [look, setLook] = useState(0);
  const blink = controlledBlink ?? autoBlink;
  const lively = animate && controlledBlink === undefined && size >= BLINK_MIN_SIZE && foreground && !reduceMotion && t.motion !== "quiet";
  useEffect(() => {
    setBlink(false); setLook(0);
    if (!lively) return;
    // Mostly blinks, now and then a glance to one side and back.
    let tick = hash(bot.id), settle: ReturnType<typeof setTimeout>;
    const timer = setInterval(() => {
      tick = Math.imul(tick ^ (tick >>> 13), 1103515245) + 12345;
      if ((tick >>> 8) % 10 < 3) { setLook((tick >>> 4) % 2 ? 1 : -1); settle = setTimeout(() => setLook(0), 1100); }
      else { setBlink(true); settle = setTimeout(() => setBlink(false), 140); }
    }, 3200 + hash(bot.id) % 2400);
    return () => { clearInterval(timer); clearTimeout(settle); };
  }, [lively, bot.id]);
  // A slow breath: a slight squash anchored at the feet. Large avatars only.
  const breath = useRef(new Animated.Value(0)).current;
  const breathing = lively && size >= 44;
  useEffect(() => {
    if (!breathing) { breath.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(breath, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
    ]));
    const start = setTimeout(() => loop.start(), hash(bot.id) % 1200);
    return () => { clearTimeout(start); loop.stop(); };
  }, [breathing, breath, bot.id]);
  const squash = t.motion === "lively" ? 0.05 : 0.03;
  const pixels = sprite(shape);
  const base = botColor(bot, t.dark);
  const fill = /^#[0-9a-f]{6}$/i.test(base) ? base : BRAND_BLUE;
  // Dark eyes with a white glint; on a very dark body the eyes turn white instead.
  const ink = eyeFill || pixels.eyeFill || (luminance(fill) < 0.12 ? "#ffffff" : "#1c1630");
  const glint = !eyeFill && !pixels.eyeFill && ink !== "#ffffff";

  return (
    <View
      accessibilityLabel={`${bot.name}${main ? tr(", Main Bot") : admin ? tr(", Admin") : ""}`}
      style={{ width: size, height: size }}
    >
      {photo && /^data:image\/(png|jpeg|webp|gif);base64,/.test(photo) ? (
        <Image
          source={{ uri: photo }}
          style={{ width: size, height: size, borderRadius: size * 0.24 }}
        />
      ) : (
        <Animated.View style={{ width: size, height: size, transform: [
          { translateY: breath.interpolate({ inputRange: [0, 1], outputRange: [0, size * squash / 2] }) },
          { scaleY: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1 - squash] }) },
          { scaleX: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + squash * 0.6] }) },
        ] }}>
        <Svg width={size} height={size} viewBox={`0 0 ${pixels.size} ${pixels.size}`}>
          {/* The outline is a full silhouette under the body, so no anti-aliased seam shows between them. */}
          <Path d={pixels.outline} fill={mix(fill, "#10102a", 0.68)} />
          {!silhouette && <Path d={pixels.litOutline} fill={mix(fill, "#10102a", 0.52)} />}
          <Path d={pixels.fill} fill={fill} />
          {!silhouette && pixels.tones.map((tone, index) => <Path key={index} d={tone.d} fill={tone.fill} opacity={tone.opacity} />)}
          {!silhouette && pixels.paints.map((paint, index) => <Path key={index} d={paint.d} fill={paint.fill} opacity={paint.opacity} />)}
          {!silhouette && <Path d={blink ? pixels.closed(look) : pixels.eyes(look)} fill={ink} />}
          {!silhouette && !blink && glint && <Path d={pixels.shine(look)} fill="#ffffff" />}
        </Svg>
        </Animated.View>
      )}
      {(main || admin) && (
        <View
          style={{
            position: "absolute",
            right: -3,
            bottom: -2,
            width: main ? size * 0.36 : size * 0.3,
            height: main ? size * 0.36 : size * 0.3,
            backgroundColor: admin && !main ? t.surface : undefined,
            borderRadius: 99,
          }}
        >
          <Svg viewBox="0 0 20 20" width="100%" height="100%">
            <Path
              d="M10 2.4l2.29 5.04 5.51.63-4.09 3.74 1.11 5.42L10 14.5l-4.82 2.73 1.11-5.42L2.2 8.07l5.51-.63z"
              fill={main ? "#e2a227" : t.muted}
              stroke={main ? t.surface : "none"}
              strokeWidth={1}
            />
          </Svg>
        </View>
      )}
      {live && (
        <View
          style={{
            position: "absolute",
            width: 8,
            height: 8,
            borderRadius: 4,
            bottom: 0,
            left: 0,
            backgroundColor: t.accent,
            borderWidth: 1.5,
            borderColor: t.surface,
          }}
        />
      )}
    </View>
  );
});
export function RoomAvatar({
  room,
  team,
  size = 36,
}: {
  room: Room;
  team: Pick<TeamState, "bots">;
  size?: number;
}) {
  const t = useTheme();
  const members = room.members
    .map((id) => team.bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => !!bot);
  const count = Math.max(2, Math.min(4, members.length));
  const positions =
    count === 2
      ? [
          [0, 0],
          [0.34, 0.34],
        ]
      : count === 3
        ? [
            [0.23, 0],
            [0, 0.44],
            [0.45, 0.44],
          ]
        : [
            [0, 0],
            [0.5, 0],
            [0, 0.5],
            [0.5, 0.5],
          ];
  const ratio = count === 2 ? 0.66 : count === 3 ? 0.55 : 0.5;
  return (
    <View accessibilityLabel={room.name} style={{ width: size, height: size }}>
      {positions.map(([left, top], index) => (
        <View
          key={index}
          style={{ position: "absolute", left: size * left, top: size * top }}
        >
          {index === 3 && members.length > 4 ? (
            <Text
              style={{
                width: size / 2,
                height: size / 2,
                textAlign: "center",
                color: t.muted,
                fontSize: size * 0.2,
              }}
            >
              +{members.length - 3}
            </Text>
          ) : members[index] ? (
            <BotAvatar bot={members[index]} size={size * ratio} />
          ) : (
            <View
              style={{
                width: size * ratio,
                height: size * ratio,
                borderRadius: size,
                backgroundColor: t.lineStrong,
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
}
