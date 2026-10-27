// Regenerates src/components/pixelCharacters.json: the 32x32 pixel characters.
//
// Each character is a body (tinted with the Bot's own colour at runtime) plus
// accessories in fixed colours. The script lights the body as a soft sphere
// from the upper left and stores a tone per pixel; the app paints those tones
// as cool shadow / warm light layers over the Bot colour, so every colour gets
// the same volume. Run: node scripts/pixel-characters.mjs
//
// Row codes: "." empty, "o" outline, "p" lit outline (top/left edges),
// body tones "d" deep shadow, "s" shadow, "b" base, "l" light, "h" highlight,
// digits: accessory paints (index into `paints`).
//
// The keys are the avatar shapes stored on the host for each bot, so existing
// bots keep their slot and get the new character in it.
import { writeFileSync } from "node:fs";

const N = 32;
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const L = (() => { const v = [-0.45, -0.6, 0.85], n = Math.hypot(...v); return v.map(c => c / n); })();
const key = (x, y) => `${x},${y}`;
const MOUTH = "#7A2846", BLUSH = "#FF8FB1";

function superellipse(cx, cy, rx, ry, power) {
  const mask = new Set();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    if (Math.abs((x + 0.5 - cx) / rx) ** power + Math.abs((y + 0.5 - cy) / ry) ** power <= 1) mask.add(key(x, y));
  return mask;
}

// Bodies: the mask plus the sphere used to light it and where the eyes sit.
const bodies = {
  round: () => ({ mask: superellipse(16, 19.5, 11, 9.5, 2.2), cx: 16, cy: 19.5, rx: 11, ry: 9.5, eyeY: 19 }),
  bean: () => ({ mask: superellipse(16, 19, 9.5, 10.5, 2.1), cx: 16, cy: 19, rx: 9.5, ry: 10.5, eyeY: 19 }),
  block: () => ({ mask: superellipse(16, 20, 11, 8.5, 4), cx: 16, cy: 20, rx: 12, ry: 10, eyeY: 20 }),
  wide: () => ({ mask: superellipse(16, 22, 12.5, 7.5, 2.4), cx: 16, cy: 22, rx: 12.5, ry: 8.5, eyeY: 22 }),
  low: () => ({ mask: superellipse(16, 22, 10, 7.5, 2.2), cx: 16, cy: 22, rx: 10, ry: 7.5, eyeY: 22 }),
  ghost: () => {
    const mask = superellipse(16, 17, 10, 9, 2);
    for (let y = 17; y <= 26; y++) for (let x = 6; x < 26; x++) {
      const phase = (x - 6) % 7;
      // Three rounded scallops along the hem.
      if (y < 25 || (phase >= 1 && phase <= 5 && !(y === 26 && (phase === 1 || phase === 5)))) mask.add(key(x, y));
    }
    return { mask, cx: 16, cy: 19, rx: 10, ry: 11, eyeY: 18 };
  },
};

// Accessory art: rows of characters stamped at (x0, y0). "B" extends the body
// (shaded with it); a digit is that paint; "." leaves the cell alone.
function stamp(grid, art, x0, y0, body) {
  art.forEach((row, dy) => [...row].forEach((cell, dx) => {
    const x = x0 + dx, y = y0 + dy;
    if (cell === "." || x < 0 || y < 0 || x >= N || y >= N) return;
    if (cell === "B") body?.add(key(x, y)); else grid[y][x] = cell;
  }));
}
const mirror = art => art.map(row => [...row].reverse().join(""));

const designs = {
  // label, body, extra body art [art, x, y][], paints, accessory art [art, x, y][], options
  hex: ["King", "round", [], ["#FFE38A", "#FFC43D", "#C9871A", "#FF4D6D"], [
    [["0....0....0", "10..010..01", "11011311011", "11111111111", "22222222222"], 10, 5]]],
  gumdrop: ["Sprout", "bean", [], ["#9BEA6A", "#5CC24A", "#2F8A3A", "#3E9E4A"], [
    [["01.....10", "0111.1110", ".1122211.", "...232...", "....3....", "....3...."], 12, 3]]],
  kitty: ["Kitty", "round", [
    [["B....", "BB...", "BBB..", "BBBB.", "BBBBB"], 6, 6], [mirror(["B....", "BB...", "BBB..", "BBBB.", "BBBBB"]), 21, 6]],
    ["#FF9EBB"], [[["....", "....", "0...", "00..", "00.."], 7, 6], [mirror(["....", "....", "0...", "00..", "00.."]), 21, 6]],
    { stripes: true }],
  bunny: ["Bunny", "low", [
    [[".BB.", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", ".BB."], 10, 3],
    [[".BB.", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", "BBBB", ".BB."], 18, 3]],
    ["#FFB3C7"], [[["..", "0.", "00", "00", "00", "00", "00", ".0"], 11, 5], [["..", ".0", "00", "00", "00", "00", "00", "0."], 19, 5]]],
  squircle: ["Robot", "block", [], ["#6B7A8F", "#FF5A6E", "#FFD0D6", "#1E2B44", "#2C3E5E"], [
    [["21", "11"], 15, 6], [["0", "0", "0", "0"], 16, 8], [["0", "0", "0"], 15, 8],
    [[".33333333333333.", "3333333333333333", "3333333333333333", "3334333333333333", "3343333333333333",
      "3333333333333333", "3333333333333333", ".33333333333333."], 8, 17],
    [["0", "0", "0"], 4, 19], [["0", "0", "0"], 27, 19]], { eyeFill: "#7CFFE0", mouth: "screen" }],
  moon: ["Angel", "ghost", [], ["#FFE066", "#FFF6B0", "#FFFFFF", "#DCE3FF"], [
    [[".0000000000.", "01........10", ".0000000000."], 10, 2],
    [["..2", ".22", "223", "233", ".33"], 3, 15], [mirror(["..2", ".22", "223", "233", ".33"]), 26, 15]]],
  gem: ["Beanie", "round", [], ["#FFFFFF", "#FF5A5F", "#D93A45", "#FFE4E5"], [
    [["...00...", "..0000..", "...00..."], 12, 2]], { dome: { top: 5, rx: 10, ry: 6, rib: true, paints: ["1", "2", "3"] } }],
  plus: ["DJ", "round", [], ["#3A3A55", "#FF8A3D", "#FFB47A", "#5A5A7A"], [
    [["......000000000000......", "....00............00....", "...0................0...", "..0..................0..",
      "..0..................0..", ".0....................0.", ".0....................0."], 4, 5],
    [[".22", "2111", "1111", "1111", "1111", "1111", ".11"], 1, 12], [mirror([".22", "2111", "1111", "1111", "1111", "1111", ".11"]), 27, 12]]],
  star: ["Star", "round", [], ["#FFD84D", "#FFF7C2"], [
    [["..0..", "..0..", "00100", "..0..", "..0.."], 21, 2], [[".0.", "010", ".0."], 7, 5]]],
  peanut: ["Bloom", "bean", [], ["#FF7EB6", "#FFB3D4", "#FFD84D", "#E0508F"], [
    [[".11.1.", "100100", ".0220.", "102200", "3003.1", ".3..3."], 19, 3]]],
  magnet: ["Imp", "round", [], ["#FFF1D6", "#D9C7A3", "#FFFFFF"], [
    [["0...", "01..", "011.", ".11."], 8, 7], [mirror(["0...", "01..", "011.", ".11."]), 20, 7]], { fang: true }],
  wave: ["Bow", "wide", [], ["#FF7EB6", "#FFB3D4", "#E0508F"], [
    [["11.......11", "1001.2.1001", "10002220001", "1001.2.1001", "11.......11"], 10, 10]]],
  pebbles: ["Tuft", "block", [[["...B.", "..BB.", ".BBB.", "BBBBB"], 14, 8], [["B.", "BB"], 12, 10]], [], []],
  saucer: ["Propeller", "round", [], ["#3DA5FF", "#FF5A5F", "#FFC83D", "#3A3A55", "#FFFFFF"], [
    [["000000.111111"], 10, 2], [["3"], 16, 3], [["3"], 16, 4]], { dome: { top: 5, rx: 10, ry: 6, paints: ["0", "1", "2"], sectors: true } }],
  beacon: ["Party", "round", [], ["#A97EFE", "#FFC83D", "#FFFFFF"], [], { cone: true }],
  acorn: ["Mushroom", "low", [], ["#FF4D4D", "#FFFFFF", "#C93636", "#FF8080"], [], { cap: true }],
  zed: ["Tetro", "block", [], ["#C08BFF", "#A35CFF", "#7A3FD0"], [], { tetro: true }],
  whale: ["Spout", "wide", [], ["#5AC8FA", "#BDEBFF"], [
    [[".1...1.", "0.1.1.0", "...0...", "...0...", "...1..."], 13, 6]]],
  ring: ["Visor", "bean", [], ["#3A3A55", "#5EE7FF", "#2C2C44"], [], { visor: true, eyeFill: "#7CFFE0" }],
  cushion: ["Mochi", "wide", [], ["#FFB3D4", "#FF7EB6", "#FFE4EF"], [
    [[".0.", "010", ".0."], 19, 12], [["2"], 20, 12]]],
};

function light(tones, mask, { cx, cy, rx, ry }) {
  for (const cell of mask) {
    const [x, y] = cell.split(",").map(Number);
    let nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    const r = Math.hypot(nx, ny);
    if (r > 1) { nx /= r; ny /= r; }
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    // Dither only a thin band at each boundary, so the face stays clean.
    const v = nx * L[0] + ny * L[1] + nz * L[2] + (BAYER[y % 4][x % 4] / 16 - 0.5) * 0.07;
    tones[y][x] = v < 0.2 ? "d" : v < 0.5 ? "s" : v < 0.9 ? "b" : "l";
  }
  // Reflected light: the outer lower edge picks up a tone, for volume.
  for (const cell of mask) {
    const [x, y] = cell.split(",").map(Number);
    const edge = [[1, 0], [-1, 0], [0, 1]].some(([dx, dy]) => !mask.has(key(x + dx, y + dy)));
    if (edge && (y + 0.5 - cy) / ry > 0.45 && tones[y][x] === "d") tones[y][x] = "s";
  }
  const hx = Math.round(cx - rx * 0.42), hy = Math.round(cy - ry * 0.48);
  for (const [x, y] of [[hx, hy], [hx + 1, hy], [hx, hy + 1]]) if (mask.has(key(x, y))) tones[y][x] = "h";
}

const characters = {};
for (const [name, [label, kind, extensions, colours, art, options = {}]] of Object.entries(designs)) {
  const shape = bodies[kind]();
  const grid = Array.from({ length: N }, () => Array(N).fill("."));
  // Light the bunny as one tall shape so its ears share the body's shading.
  if (name === "bunny") Object.assign(shape, { cy: shape.cy - 3, ry: shape.ry + 3 });
  for (const [a, x, y] of extensions) stamp(grid, a, x, y, shape.mask);
  light(grid, shape.mask, shape);
  const paints = colours.map(fill => [fill, 1]);
  const paint = (fill, opacity = 1) => { paints.push([fill, opacity]); return String(paints.length - 1); };
  const top = Math.min(...[...shape.mask].map(cell => Number(cell.split(",")[1])));
  const ex = [shape.cx - 5, shape.cx + 3], ey = shape.eyeY;

  if (options.stripes) for (const [x, y] of [[15, top + 1], [16, top + 1], [16, top + 2], [13, top + 2], [19, top + 2]]) grid[y][x] = "d";
  if (options.dome) {
    // A cap over the top of the head, ribbed or split into coloured sectors.
    const { rx, ry, paints: [main, dark, rib] } = options.dome, base = options.dome.top + ry;
    for (let y = options.dome.top; y <= base; y++) for (let x = 0; x < N; x++) {
      if (((x + 0.5 - 16) / rx) ** 2 + ((y + 0.5 - base) / ry) ** 2 > 1) continue;
      if (options.dome.sectors) grid[y][x] = x < 12 ? main : x < 20 ? dark : rib;
      else grid[y][x] = y >= base - 1 ? (x % 2 ? rib : dark) : x - 16 < -rx * 0.4 && y < base - 2 ? rib : main;
    }
  }
  if (options.cone) for (let y = 2; y <= top + 1; y++) {
    const half = (y - 2) * 0.62;
    for (let x = 0; x < N; x++) if (Math.abs(x + 0.5 - 16) <= half + 0.5) grid[y][x] = ((x - y + 64) % 4 < 2) ? "0" : "1";
    if (y === 2) grid[1][15] = grid[1][16] = grid[2][15] = "2";
  }
  if (options.cap) for (let y = 3; y <= top + 3; y++) for (let x = 0; x < N; x++) {
    if (((x + 0.5 - 16) / 13) ** 2 + ((y + 0.5 - (top + 3)) / 9) ** 2 > 1) continue;
    const spot = [[10, 7], [11, 7], [10, 8], [20, 6], [21, 6], [21, 7], [15, 4], [16, 4], [6, top], [25, top]].some(([sx, sy]) => sx === x && sy === y);
    grid[y][x] = spot ? "1" : y === top + 3 ? "2" : x < 11 && y < top ? "3" : "0";
  }
  if (options.tetro) {
    const block = (bx, by) => { for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) grid[by + y][bx + x] = x === 0 || y === 0 ? "0" : x === 2 || y === 2 ? "2" : "1"; };
    block(11, top - 6); block(14, top - 6); block(17, top - 6); block(14, top - 3);
  }
  if (options.visor) for (let y = ey - 3; y <= ey + 2; y++) for (let x = 7; x <= 24; x++) {
    if ((x === 7 || x === 24) && (y === ey - 3 || y === ey + 2)) continue;
    grid[y][x] = y === ey + 2 ? "2" : [9, 10].includes(x - (y - ey + 3)) && y < ey ? "1" : "0";
  }
  for (const [a, x, y] of art) stamp(grid, a, x, y);

  // Face: blush and mouth are paints; eyes are their own layer.
  const blush = paint(BLUSH, 0.55), mouth = paint(MOUTH);
  if (options.mouth !== "screen") {
    if (!options.visor) for (const bx of [ex[0] - 3, ex[1] + 2]) for (const x of [bx, bx + 1]) if (shape.mask.has(key(x, ey + 2))) grid[ey + 2][x] = blush;
    grid[ey + 3][15] = grid[ey + 3][16] = mouth;
    if (options.fang) grid[ey + 4][16] = paint("#FFFFFF");
  }
  const eyes = ex.map(x => [[x, ey - 2], [x + 1, ey - 2], [x, ey - 1], [x + 1, ey - 1], [x, ey], [x + 1, ey], [x, ey + 1], [x + 1, ey + 1]]);
  const shine = ex.map(x => [[x, ey - 2], [x, ey - 1]]).flat();
  const closed = ex.map(x => [[x - 1, ey], [x, ey + 1], [x + 1, ey + 1], [x + 2, ey]]);
  if (options.mouth === "screen") {
    const screenMouth = paint(options.eyeFill);
    for (const [x, y] of [[14, ey + 3], [15, ey + 4], [16, ey + 4], [17, ey + 3]]) grid[y][x] = screenMouth;
  }

  // One-pixel outline around everything drawn; the top/left side is lit.
  const drawn = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !".op".includes(grid[y][x]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (grid[y][x] !== ".") continue;
    if (drawn(x + 1, y) || drawn(x, y + 1)) grid[y][x] = "p";
    else if (drawn(x - 1, y) || drawn(x, y - 1)) grid[y][x] = "o";
  }
  characters[name] = {
    label,
    rows: grid.map(row => row.join("")),
    eyes, shine, closed,
    paints,
    ...(options.eyeFill ? { eyeFill: options.eyeFill } : {}),
  };
}
const root = new URL("../src/components/", import.meta.url);
writeFileSync(new URL("pixelCharacters.json", root), JSON.stringify({ size: N, characters }) + "\n");
console.log(`Wrote ${Object.keys(characters).length} pixel characters`);
