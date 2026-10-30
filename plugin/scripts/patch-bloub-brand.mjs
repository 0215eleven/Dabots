// Draws OpenBot's Bloub robot wherever DS Bot used its own character art:
// the "DS Bot" brand chip, the footer avatar and the About page, and every Bot
// avatar in the sidebar, lists and messages.
//
// The source-client builder and pack pipeline share this idempotent transformation.
// It also accepts the prebuilt DS Bot 0.1.7 clients used by compatibility fixtures.
//
//   node scripts/patch-bloub-brand.mjs <path/to/client.js>
//
// Paths come from the MIT package @norbert_bodziony/bloub 0.4.1 (scripts/bloub-paths.json).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const MARKER = 'BT-BLOUB-BRAND'
const OLD_STYLE = '.bt-brand-whale{display:inline-flex;color:var(--bt-accent)}'
const NEW_STYLE = [
  '.bt-brand-bloub{display:inline-flex;flex:none;color:#4D6BFE;line-height:0}',
  '.bt-brand-bloub svg{width:100%;height:100%;overflow:visible}',
  '.bt-brand-bloub .bt-bloub-body{fill:currentColor;transform-box:fill-box;transform-origin:50% 100%}',
  '.bt-brand-bloub .bt-bloub-eyes{transform-box:fill-box;transform-origin:center}',
  '.bt-brand-bloub .bt-bloub-eye{fill:#fff}',
  'body:not([data-bt-motion=quiet]) .bt-brand-bloub .bt-bloub-body{animation:bt-bloub-breathe 3.6s ease-in-out infinite}',
  'body:not([data-bt-motion=quiet]) .bt-brand-bloub .bt-bloub-eyes{animation:bt-bloub-blink 5.2s linear infinite}',
  '@keyframes bt-bloub-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,.982)}}',
  '@keyframes bt-bloub-blink{0%,95.5%,100%{transform:scaleY(1)}97%{transform:scaleY(.08)}98.5%{transform:scaleY(1)}}',
  '.bt-mark .bt-bloub-breathe{transform-box:fill-box;transform-origin:50% 100%}',
  '.bt-mark .bt-bloub-eye{transform-box:fill-box;transform-origin:center}',
  // Avatars move on their own, not only in the "live" state the old marks used:
  // a list of Bots that never blink reads as a row of still images.
  'body:not([data-bt-motion=quiet]) .bt-mark .bt-bloub-breathe{animation:bt-bloub-breathe 3.8s ease-in-out infinite}',
  'body:not([data-bt-motion=quiet]) .bt-mark .bt-bloub-eye{animation:bt-bloub-blink 5.4s linear infinite}',
  '@media(prefers-reduced-motion:reduce){.bt-brand-bloub *,.bt-mark .bt-bloub-breathe,.bt-mark .bt-bloub-eye{animation:none!important}}',
].join('\n')

function buildBlock(paths) {
  return [
    `// ${MARKER}: OpenBot's Bloub robot (MIT @norbert_bodziony/bloub 0.4.1).`,
    `var BLOUB_VIEWBOX = ${JSON.stringify(paths.brandViewBox)};`,
    `var BLOUB_BODY = ${JSON.stringify(paths.brand.body)};`,
    `var BLOUB_BODY_ALPHA = ${JSON.stringify(paths.brand.bodyAlpha)};`,
    `var BLOUB_EYES = ${JSON.stringify(paths.brand.eyes)};`,
    `var BLOUB_AVATARS = ${JSON.stringify(paths.variants)};`,
    'function bloubBrandMarkup() {',
    '  // Eyes are enlarged: the engine draws them for a 200 px body, where they are',
    '  // 2 px at the 20 px chip size and read as a blank dot.',
    '  var eyes = BLOUB_EYES.map(function (eye) {',
    '    return \'<g transform="\' + eye.matrix + \'"><g transform="scale(1.5)"><path class="bt-bloub-eye" d="\' + eye.d + \'" opacity="\' + eye.alpha + \'" /></g></g>\';',
    '  }).join("");',
    '  return \'<svg viewBox="\' + BLOUB_VIEWBOX + \'" aria-hidden="true"><path class="bt-bloub-body" d="\' + BLOUB_BODY + \'" opacity="\' + BLOUB_BODY_ALPHA + \'" /><g class="bt-bloub-eyes">\' + eyes + \'</g></svg>\';',
    '}',
    '// One stable silhouette per stored shape, so a Bot keeps its look between mounts.',
    'function bloubHash(value) {',
    '  var hash = 2166136261;',
    '  for (var index = 0; index < value.length; index += 1) { hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); }',
    '  return hash >>> 0;',
    '}',
    'function bloubAvatarMarkup(shape, color) {',
    '  var variant = BLOUB_AVATARS[bloubHash(String(shape)) % BLOUB_AVATARS.length];',
    '  var bodyHex = isHex(color) ? color : INKS[inkName(color)][0];',
    '  var dark = luminance(bodyHex) < 0.42;',
    '  var eyeHex = dark ? "#ffffff" : "#1c1630";',
    '  var outline = dark ? \' stroke="rgba(255,255,255,0.34)" stroke-width="4"\' : "";',
    '  var eyes = variant.eyes.map(function (eye) {',
    '    return \'<g transform="\' + eye.matrix + \'"><g transform="scale(1.45)"><path class="bt-eye bt-bloub-eye" fill="\' + eyeHex + \'" d="\' + eye.d + \'" opacity="\' + eye.alpha + \'" /></g></g>\';',
    '  }).join("");',
    '  // Geometry sits on an inner group: the mark CSS animates .bt-b and .bt-eye with',
    '  // their own transform, which would otherwise replace the attribute transform.',
    '  // The outermost group carries the idle breathing so it never fights the layout.',
    '  return \'<g class="bt-bloub-breathe"><g class="bt-b"><g class="bt-bloub-avatar" transform="translate(50 50) scale(0.38)"><path d="\' + variant.body + \'" fill="\' + bodyHex + \'" opacity="\' + variant.bodyAlpha + \'"\' + outline + \' /><g class="bt-eyes">\' + eyes + \'</g></g></g></g>\';',
    '}',
    '',
  ].join('\n')
}

function replaceFunctionBody(source, declaration, body) {
  const start = source.indexOf(declaration)
  if (start < 0) throw new Error(`${declaration} not found in this client.js`)
  // The supported source-built and public 0.1.7 clients use readable esbuild
  // output: nested blocks are indented, and the function closes at column zero.
  const end = source.indexOf('\n}', start + declaration.length)
  if (end < 0) throw new Error(`${declaration} has no closing brace in this client.js`)
  return source.slice(0, start) + `${declaration}\n${body}\n}` + source.slice(end + 2)
}

export function patchBloubBrand(source) {
  const paths = JSON.parse(readFileSync(join(here, 'bloub-paths.json'), 'utf8'))
  let out = source

  // 1. Stylesheet: the brand mark plus the avatar transform hook.
  if (out.includes(OLD_STYLE)) out = out.replace(OLD_STYLE, NEW_STYLE)
  else if (!out.includes('.bt-brand-bloub{')) out = out.replace('var SIDEBAR_CSS = `', `var SIDEBAR_CSS = \`\n${NEW_STYLE}`)

  // 2. The definitions, once, just ahead of the brand renderer.
  if (!out.includes(MARKER)) {
    const anchor = 'function BrandMark({ size = 24 }) {'
    if (!out.includes(anchor)) throw new Error('BrandMark not found in this client.js')
    out = out.replace(anchor, `${buildBlock(paths)}${anchor}`)
  }

  // 3. BrandMark: the mark itself.
  const oldRender = 'return (0, import_react9.createElement)("span", { className: "bt-brand-whale" }, (0, import_react9.createElement)(BotMark, { look: MAIN_LOOK, size }));'
  const newRender = 'return (0, import_react9.createElement)("span", { className: "bt-brand-bloub", style: { width: size, height: size }, dangerouslySetInnerHTML: { __html: bloubBrandMarkup() } });'
  if (out.includes(oldRender)) out = out.replace(oldRender, newRender)

  // 4. Every other place that drew the brand look: footer avatar, launcher mark,
  // welcome mark, About page. Each becomes the same Bloub span at its own size.
  out = out.replace(
    /\(0, (import_react\d+)\.createElement\)\(BotMark, \{ look: MAIN_LOOK, (?:[^{}]|\{[^{}]*\})*\}\)/g,
    (match, react) => {
      const size = /size: (\d+)/.exec(match)?.[1] ?? '24'
      return `(0, ${react}.createElement)("span", { className: "bt-brand-bloub", style: { width: ${size}, height: ${size} }, dangerouslySetInnerHTML: { __html: bloubBrandMarkup() } })`
    },
  )

  // 5. Every Bot avatar: characterMarkup is the single door the mark system uses.
  // Replace the whole body, including dead legacy tails from earlier patches.
  out = replaceFunctionBody(out, 'function characterMarkup(shape, color) {',
    '  return bloubAvatarMarkup(shape, color);')

  // 6. A group chat draws one face, not a cluster of overlapping avatars.
  const roomAnchor = 'function RoomAvatar({ room: room2, roster, size = 36 }) {'
  if (out.includes(roomAnchor)) {
    out = replaceFunctionBody(out, roomAnchor, [
      '  const members = room2.members.map((id) => roster.byId[id]).filter(Boolean);',
      '  // Bloub: one seat per group, so a list row shows one readable face.',
      '  if (members.length > 0) return (0, import_react2.createElement)(BotMark, { bot: members[0], size });',
      '  return (0, import_react2.createElement)(BotMark, { size });',
    ].join('\n'))
  }

  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2]
  if (!target) throw new Error('usage: node patch-bloub-brand.mjs <client.js>')
  const before = readFileSync(target, 'utf8')
  const after = patchBloubBrand(before)
  if (after === before) {
    console.log('already patched:', target)
  } else {
    writeFileSync(target, after)
    console.log('patched:', target)
  }
}
