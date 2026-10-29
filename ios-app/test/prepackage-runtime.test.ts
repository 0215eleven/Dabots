import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
function bundled(entry: string, native = false, external: string[] = []) {
  return buildSync({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    platform: 'node', format: 'cjs', metafile: true, external, supported: { 'dynamic-import': false },
    resolveExtensions: native ? ['.ios.ts', '.native.ts', '.ts', '.tsx', '.js'] : ['.ts', '.tsx', '.js'],
    logLevel: 'silent' });
}
function evaluate(result: ReturnType<typeof bundled>, load = require): any {
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles![0].text)(module, module.exports, load);
  return module.exports;
}

// Reintroducing another catalog dependency grows the shipped graph even if its require is lazy.
for (const native of [false, true]) {
  test(`${native ? 'native' : 'web'} mobile catalog ships only en/zh and falls back with English plural rules`, () => {
    const result = bundled('openbot/packages/i18n/src/mobile.ts', native);
    const api = evaluate(result);
    assert.equal(api.mobileTranslateFor('en')('common.cancel'), 'Cancel');
    assert.equal(api.mobileTranslateFor('zh')('common.cancel'), '取消');
    assert.equal(api.mobileTranslateFor('fr')('common.cancel'), 'Cancel');
    assert.equal(api.mobileTranslateFor('fr')('mobile.chat.preview.lines', { count: 0 }), '0 lines');
    assert.equal(api.mobileTranslateFor('ja')('mobile.chat.preview.lines', { count: 1 }), '1 line');
    assert.equal(api.localizeSourceText('The remote operation failed.', 'zh'), '远程操作失败。');
    assert.equal(api.localizeSourceText('The remote operation failed.', 'de'), 'The remote operation failed.');
    const languages = [...new Set(Object.keys(result.metafile!.inputs)
      .flatMap(path => path.match(/\/messages\/([^/]+)\//)?.[1] ?? []))].sort();
    assert.deepEqual(languages, ['en', 'zh']);
  });
}

test('unsupported saved or system language resolves to English without losing system number/date region', () => {
  const api = evaluate(bundled('openbot/packages/i18n/src/locale.ts'));
  assert.equal(api.resolveLocale('fr', 'zh-CN'), 'en');
  assert.equal(api.resolveLocale('system', 'fr-CA'), 'en');
  assert.equal(api.resolveLocale('system', 'zh-Hans-CN'), 'zh');
  assert.equal(api.resolveLocale('unknown', 'zh-CN'), 'en');
  assert.equal(api.resolveLocale('zh', 'en-US'), 'zh');
  assert.equal(api.formatLocale('system', 'fr-CA'), 'fr-CA');
  assert.equal(api.formatLocale('en', 'zh-CN'), 'en');
  assert.equal(api.formatLocale('zh', 'zh-CN'), 'zh-CN');
  assert.ok(api.TRANSLATED_LOCALES.includes('fr'), 'upstream protocol vocabulary stays intact');
});

test('format and source catalogs fall back to English for an unshipped language', () => {
  const formats = evaluate(bundled('openbot/packages/i18n/src/format.ts'));
  assert.equal(formats.createFormat('en').list(['A', 'B']), 'A and B');
  assert.equal(formats.createFormat('zh').list(['A', 'B']), 'A和B');
  const source = evaluate(bundled('openbot/packages/i18n/src/source-text.ts'));
  assert.equal(source.sourceTranslateFor('de')('error.remote.operationFailed'), 'The remote operation failed.');
});

test('shared root catalog entry also ships only English and Chinese', () => {
  const result = bundled('openbot/packages/i18n/src/index.ts');
  const api = evaluate(result);
  assert.equal(api.translateFor('zh')('common.cancel'), '取消');
  assert.equal(api.translateFor('fr')('common.cancel'), 'Cancel');
  const languages = [...new Set(Object.keys(result.metafile!.inputs)
    .flatMap(path => path.match(/\/messages\/([^/]+)\//)?.[1] ?? []))].sort();
  assert.deepEqual(languages, ['en', 'zh']);
});

test('iOS autolinking omits unsupported permissions/features while preserving QR and current native UI', async () => {
  const { createAutolinkingOptionsLoader } = require('../node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js');
  const { resolveExpoModule } = require('../node_modules/expo-modules-autolinking/build/autolinking/findModules.js');
  const loader = createAutolinkingOptionsLoader({ projectRoot: root });
  const excluded = ['expo-local-authentication', 'expo-speech-recognition', 'expo-device', 'expo-web-browser',
    'expo-updates', 'expo-keep-awake', 'expo-media-library', 'expo-video', 'expo-audio', 'expo-image-picker',
    'expo-speech', 'expo-document-picker', 'expo-image-manipulator'];
  for (const platform of ['ios', 'apple']) {
    const options = await loader.getPlatformOptions(platform);
    for (const name of excluded) {
      const resolution = { name, path: join(root, 'node_modules', name), version: 'test', duplicates: [] };
      assert.equal(await resolveExpoModule(resolution, 'apple', new Set(options.exclude)), null, `${platform}: ${name}`);
    }
    for (const name of ['expo-camera', 'expo-widgets', 'expo-secure-store', 'expo-sqlite']) {
      const resolution = { name, path: join(root, 'node_modules', name), version: 'test', duplicates: [] };
      assert.ok(await resolveExpoModule(resolution, 'apple', new Set(options.exclude)), name);
    }
    assert.ok(!options.exclude.includes('@shopify/react-native-skia'));
    assert.ok(!options.exclude.includes('react-native-webview'));
  }
});

test('resolved lite iOS privacy only requests QR camera and paired-computer network access', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'introspect', '--json'], {
    cwd: root, env: { ...process.env, EXPO_NO_TELEMETRY: '1', DS_BOT_NO_WIDGETS: '1' }, encoding: 'utf8',
  }));
  const info = result._internal.modResults.ios.infoPlist;
  const usageKeys = Object.keys(info).filter(key => key.endsWith('UsageDescription')).sort();
  assert.deepEqual(usageKeys, ['NSCameraUsageDescription', 'NSLocalNetworkUsageDescription']);
  assert.match(info.NSCameraUsageDescription, /pairing QR code/);
  assert.equal(result.ios.bundleIdentifier, 'app.dsbot.mobile');
  assert.equal(result.scheme, 'dsbot');
  assert.ok(!result.plugins.some((item: string | string[]) => (Array.isArray(item) ? item[0] : item) === 'expo-widgets'));
});

test('local failure alerts work without loading telemetry, Effect, Application or report storage', async () => {
  const result = bundled('openbot/mobile/src/features/analytics/failure-reports.ts', false,
    ['react-native', '@/shared/lib/text', 'expo-*', 'effect', '@openbot/telemetry']);
  const alerts: any[][] = [], copied: string[] = [];
  const mobile = evaluate(bundled('openbot/packages/i18n/src/mobile.ts'));
  const load = ((name: string) => {
    if (name === 'react-native') return { Alert: { alert: (...args: any[]) => alerts.push(args) } };
    if (name === '@/shared/lib/text') return { currentText: () => ({ t: mobile.mobileTranslateFor('en') }) };
    if (name === 'expo-clipboard') return { setStringAsync: async (value: string) => { copied.push(value); } };
    throw new Error(`Forbidden local-alert runtime dependency: ${name}`);
  }) as typeof require;
  let api: any;
  assert.doesNotThrow(() => { api = evaluate(result, load); });
  assert.equal(api.mobileReportQueue(), undefined);
  api.reportMobileNotification(new Error('offline'), 'turn');
  assert.equal(alerts.length, 0);
  api.showFailureAlert(new Error('plain'), 'turn', 'Failed', 'Try again');
  assert.deepEqual(alerts.pop(), ['Failed', 'Try again']);
  api.showFailureAlert({ reference: 'http/403/denied' }, 'turn', 'Failed', 'Try again');
  const alert = alerts.pop()!;
  assert.match(alert[1], /http\/403\/denied/);
  assert.equal(alert[2].length, 2);
  await alert[2][1].onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copied, ['http/403/denied']);
  const buttons = [{ text: 'A' }, { text: 'B' }, { text: 'C' }];
  api.showFailureAlert({ reference: 'http/403/denied' }, 'turn', 'Failed', 'Try again', buttons);
  assert.deepEqual(alerts.pop()![2], buttons, 'preserve three existing action buttons');
  api.showWarningAlert('turn', 'Warning', 'Read this');
  assert.deepEqual(alerts.pop(), ['Warning', 'Read this']);
});
