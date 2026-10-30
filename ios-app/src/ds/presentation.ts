import data from '../components/characterData.json';
import type { AvatarHue } from '../../openbot/packages/contracts/src/ipc-agent-identity';
// OpenBot's avatar renderer uses its fixed hue palette. DS keeps the original hex
// unchanged; this is a presentation-only nearest hue, with avatar color preferred.
const hues: readonly AvatarHue[] = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320];
export function botAvatarHue(bot: {color?: string | null; avatar?: {color?: string; shape?: string; image?: string} | null}): AvatarHue | null {
  const color = botAvatarColor(bot);
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  const [r,g,b] = [1,3,5].map(offset => parseInt(color.slice(offset,offset+2),16)/255);
  const high=Math.max(r,g,b), low=Math.min(r,g,b), delta=high-low;
  if (!delta) return null;
  const hue=((high===r?(g-b)/delta:high===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360;
  const distance=(value:number)=>Math.min(Math.abs(value-hue),360-Math.abs(value-hue));
  return hues.reduce((best,value)=>distance(value)<distance(best)?value:best);
}

/** Exact DS color for the SVG renderer; no stored profile fields are rewritten. */
export function botAvatarColor(bot: {color?: string | null; avatar?: {color?: string; shape?: string; image?: string} | null}, dark = false): string | null {
  for (const color of [bot.avatar?.color, bot.color]) {
    if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
    const palette = color && Object.hasOwn(data.inks, color) ? (data.inks as Record<string, string[]>)[color] : null;
    if (palette) return palette[dark ? 1 : 0];
  }
  return null;
}

// A Bot without a DS color still gets one of DS's own vivid inks, chosen by its stable ID, so the list
// never falls back to the muted colors of the generated avatar palette.
const FALLBACK_INKS = ['deepseek', 'violet', 'sky', 'tangerine', 'green', 'magenta', 'yellow', 'cyan', 'blue', 'rose'] as const;
export function fallbackAvatarColor(id: string, dark = false): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const ink = (data.inks as Record<string, string[]>)[FALLBACK_INKS[hash % FALLBACK_INKS.length]];
  return ink[dark ? 1 : 0];
}
