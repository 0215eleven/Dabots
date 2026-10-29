import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { notificationTitle } from "../src/logic/notifications.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const json = (path: string) => JSON.parse(read(path));
// DS Bot / DSH host capabilities and OpenBot provenance keep their real names.
// These are former *app* names, never pairing, module or storage identifiers.
const formerAppName = /\b(?:DS Bot Mobile(?: App)?|DS Bot App|Mobile DS(?: 2\.0)?|OpenBot)\b/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function literals(path: string): string[] {
  const values: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) || ts.isJsxText(node)) values.push(node.text.trim());
    ts.forEachChild(node, visit);
  }
  visit(source(path));
  return values;
}

const uiFiles = [...files(join(root, "app")), ...files(join(root, "src"))]
  .filter(path => !relative(root, path).replaceAll("\\", "/").startsWith("src/openbot/pkg/"));

test("launcher and web names use Dbot pro while installation and link identities stay compatible", () => {
  const expo = json("app.json").expo;
  assert.equal(expo.name, "Dbot pro");
  assert.equal(expo.web.name, "Dbot pro");
  assert.equal(expo.ios.bundleIdentifier, "app.dsbot.mobile");
  assert.equal(expo.android.package, "app.dsbot.mobile");
  assert.equal(expo.slug, "ds-bot-mobile-app");
  assert.equal(expo.scheme, "dsbot");
  assert.equal(json("package.json").name, "@ds-bot/mobile");
  assert.match(expo.ios.infoPlist.NSLocalNetworkUsageDescription, /Dbot pro/);
  assert.equal(notificationTitle("unknown-future-kind"), "Dbot pro");
});

test("both settings surfaces, pairing, about and notifications retain the product display name", () => {
  for (const path of ["app/settings.tsx", "src/App.tsx", "src/screens/SettingsScreen.tsx",
    "src/screens/PairingScreen.tsx", "src/host-settings/AboutPanel.tsx", "src/media/notifications.ts"]) {
    assert.ok(literals(join(root, path)).some(value => value.includes("Dbot pro")), path);
  }
  for (const path of uiFiles) {
    assert.deepEqual(literals(path).filter(value => formerAppName.test(value)), [], relative(root, path));
  }
  for (const path of ["src/i18n.zh.json", "src/i18n.mobile.zh.json", "src/i18n.ds2.zh.json", "src/host-settings/locale.zh.json"]) {
    assert.deepEqual(Object.values(json(path)).filter(value => typeof value === "string" && formerAppName.test(value)), [], path);
  }
});

test("UI does not consume an upstream catalog entry that would display the upstream app brand", () => {
  // Keep the original catalogs and notices intact. Catch accidental use of one of
  // their old app-specific labels when adding a screen to the adapted phone UI.
  const brandedKeys = new Map<string, string>();
  for (const path of files(join(root, "src/openbot/pkg/i18n/messages"))) {
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) &&
        ts.isStringLiteralLike(node.initializer) && formerAppName.test(node.initializer.text)) {
        brandedKeys.set(node.name.text, node.initializer.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source(path));
  }
  assert.ok(brandedKeys.size > 0, "upstream catalog scan must not silently be empty");
  for (const path of uiFiles) {
    assert.deepEqual(literals(path).filter(value => brandedKeys.has(value)), [], relative(root, path));
  }
});

test("native notification text is branded without renaming channels or native modules", () => {
  const android = read("modules/background-notifications/android/src/main/java/app/dsbot/notifications/BackgroundNotificationService.kt");
  const ios = read("modules/background-notifications/ios/BackgroundNotificationsModule.swift");
  for (const text of [android, ios]) {
    const strings = [...text.matchAll(/"([^"\n]*)"/g)].map(match => match[1]);
    assert.ok(strings.some(value => value.includes("Dbot pro")));
    assert.deepEqual(strings.filter(value => formerAppName.test(value) || /\bDS Bot\b/.test(value)), []);
  }
  assert.match(android, /STATUS_CHANNEL = "ds-bot-background"/);
  assert.match(android, /ALERT_CHANNEL = "ds-bot"/);
  assert.match(ios, /Name\("DSBotBackgroundNotifications"\)/);
  assert.ok(literals(join(root, "src/media/notifications.ts")).includes("ds-bot"));
});

test("saved credentials, caches and Live Activity links keep their existing identities", () => {
  for (const [path, identity] of [
    ["src/storage/credentials.ts", "ds-bot.mobile.session"],
    ["src/storage/cache.ts", "ds-bot-mobile.db"],
    ["src/storage/cache.web.ts", "ds-bot:cache:"],
    ["src/media/background-notifications.ts", "DSBotBackgroundNotifications"],
    ["src/components/SelectableText.tsx", "DSBotSelectableText"],
    ["src/network/client.ts", "DSBotLocalTLS"],
    ["src/liveactivity/controller.ts", "dsbot://"],
    ["src/liveactivity/BotActivity.tsx", "BotActivity"],
  ]) assert.ok(literals(join(root, path)).includes(identity), `${path}: ${identity}`);
});
