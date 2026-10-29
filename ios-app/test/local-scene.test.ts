import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const { transform } = require('../plugins/withLocalSceneLifecycle.cjs');
const legacy = '    window = UIWindow(frame: UIScreen.main.bounds)\n    factory.startReactNative(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions)\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate {';

test('local iOS Scene adaptation moves React Native startup to the actual UIWindowScene', () => {
  const fixed = transform(legacy);
  assert.match(fixed, /class SceneDelegate: UIResponder, UIWindowSceneDelegate/);
  assert.match(fixed, /UIWindow\(windowScene: windowScene\)/);
  assert.ok(!fixed.includes('UIWindow(frame: UIScreen.main.bounds)'));
  assert.match(fixed, /openURLContexts/);
  assert.match(fixed, /continue userActivity/);
});
test('local iOS Scene adaptation is repeatable and rejects unfamiliar Expo templates', () => {
  const fixed = transform(legacy);
  assert.equal(transform(fixed), fixed);
  assert.throws(() => transform('unfamiliar updated Expo template'), /needs review/);
});
test('the SDK 58 template already owns the scene life cycle and is left untouched', () => {
  const sdk58 = '    // The window is created and React Native is started by `SceneDelegate` under the\n    // scene-based life cycle (required by the iOS 27 SDK).\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate {';
  assert.equal(transform(sdk58), sdk58);
});
