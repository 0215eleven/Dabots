import { tabOf, tabRoute } from '../src/logic/app-navigation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { StackRouter, StackActions, CommonActions } = require('@react-navigation/routers');
const home = { page: 'home' };

function mountNavigator(os = 'ios') {
  const router = StackRouter({ initialRouteName: 'Page' });
  const config = { routeNames: ['Page'], routeParamList: { Page: { destination: home } }, routeGetIdList: {} };
  let state = router.getInitialState(config);
  const actions: any[] = [];
  const ref = {
    isReady: () => true,
    getRootState: () => state,
    dispatch(action: any) {
      actions.push(action);
      state = router.getStateForAction(state, action, config) || state;
    },
    canGoBack: () => state.index > 0,
    goBack() { this.dispatch(CommonActions.goBack()); },
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
    useRef: (current: unknown) => ({ current }),
    createElement: (type: unknown, props: any, ...children: unknown[]) => ({ type, props: { ...props, children } }),
  };
  const module = { exports: {} as any };
  const source = readFileSync(new URL('../src/components/NativeNavigation.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  runInNewContext(output, { module, exports: module.exports, require(name: string) {
    if (name === 'react') return react;
    if (name === '@react-navigation/native') return { NavigationContainer: 'NavigationContainer', createNavigationContainerRef: () => ref, StackActions, CommonActions };
    if (name === '@react-navigation/native-stack') return { createNativeStackNavigator: () => ({ Navigator: 'Navigator', Screen: 'Screen' }) };
    if (name === 'react-native') return { Platform: { OS: os } };
    if (name === '../logic/app-navigation') return { tabOf, tabRoute };
    if (name === '../theme') return { useTheme: () => ({ bg: 'surface' }) };
    if (name === './ScreenActivity') return { ScreenActivity: { Provider: 'Activity' } };
    throw Error(name);
  } });
  return { navigator: module.exports.createAppNavigator(), component: module.exports.NativeNavigation, actions,
    routes: () => Array.from(state.routes, (item: any) => item.params.destination), top: () => state.routes[state.index].params.destination };
}

test('Appearance pops to the retained Settings page and only the next pop returns Home', () => {
  const app = mountNavigator();
  app.navigator.open({ page: 'settings' });
  // Settings is pushed above the conversation list; Appearance above Settings.
  assert.deepEqual(app.routes(), [home, { page: 'settings' }]);
  app.navigator.open({ page: 'settings', initial: 'general' });
  assert.deepEqual(app.routes(), [home, { page: 'settings' }, { page: 'settings', initial: 'general' }]);
  app.navigator.back();
  assert.deepEqual(app.top(), { page: 'settings' });
  app.navigator.back();
  assert.deepEqual(app.top(), home);
  app.navigator.open({ page: 'settings' });
  app.navigator.open(home);
  assert.deepEqual(app.routes(), [home]);
});

test('tools children preserve their real parent and reuse an existing ancestor', () => {
  const app = mountNavigator();
  app.navigator.open({ page: 'settings' });
  app.navigator.open({ page: 'settings', initial: 'tools' });
  app.navigator.open({ page: 'settings', initial: 'skills' });
  app.navigator.back();
  assert.deepEqual(app.top(), { page: 'settings', initial: 'tools' });
  app.navigator.open({ page: 'settings', initial: 'index' });
  assert.deepEqual(app.routes(), [home, { page: 'settings' }]);
});

test('team profile chat returns to the actual profile with one retained chat instance', () => {
  const app = mountNavigator();
  const list = { page: 'team', section: 'bots' };
  const profile = { page: 'team', section: 'bots', id: 'alice', subpage: 'bot' };
  app.navigator.open(list); app.navigator.open(profile);
  app.navigator.open({ page: 'chat', id: 'bot:alice' });
  app.navigator.open({ page: 'team', section: 'bots', id: 'alice', subpage: 'memory' });
  app.navigator.open({ page: 'chat', id: 'bot:bob' });
  assert.equal(app.routes().filter((route: any) => route.page === 'chat').length, 1);
  assert.deepEqual(app.top(), { page: 'chat', id: 'bot:bob' });
  app.navigator.back();
  assert.deepEqual(app.top(), { page: 'team', section: 'bots', id: 'alice', subpage: 'memory' });
  app.navigator.open({ ...list, subpage: 'list', id: 'alice' });
  assert.deepEqual(app.routes(), [home, list]);
});

test('creation completion replaces the form so back returns to its origin', () => {
  const app = mountNavigator();
  app.navigator.open({ page: 'team', section: 'groups' });
  app.navigator.open({ page: 'team', section: 'groups', create: 'group' });
  app.navigator.open({ page: 'chat', id: 'room:new' });
  assert.equal(app.routes().some((route: any) => route.create), false);
  app.navigator.back();
  assert.deepEqual(app.top(), { page: 'team', section: 'groups' });
});

test('cancelling creation restores the actual home or team origin', () => {
  for (const kind of ['bot', 'group']) {
    for (const fromList of [false, true]) {
      const app = mountNavigator();
      const list = { page: 'team', section: kind === 'bot' ? 'bots' : 'groups' };
      if (fromList) app.navigator.open(list);
      app.navigator.open({ ...list, create: kind });
      app.navigator.back();
      assert.deepEqual(app.top(), fromList ? list : home);
      assert.equal(app.routes().some((route: any) => route.create), false);
    }
  }
});

test('the home reset used when changing computers removes old profiles, chats and creation pages', () => {
  const app = mountNavigator();
  app.navigator.open({ page: 'settings' });
  app.navigator.open({ page: 'team', section: 'bots', id: 'old-computer-bot' });
  app.navigator.open({ page: 'chat', id: 'bot:old-computer-bot' });
  app.navigator.open({ page: 'team', section: 'groups', create: 'group' });
  app.navigator.open(home);
  assert.deepEqual(app.routes(), [home]);
  app.navigator.back();
  assert.deepEqual(app.top(), home);
  app.navigator.open({ page: 'settings' });
  app.navigator.back();
  assert.deepEqual(app.routes(), [home]);
});

test('native interactive transition exposes real previous pages and owns edge recognition', () => {
  const app = mountNavigator();
  let reported: unknown;
  const tree = app.component({ navigator: app.navigator, render: () => null, onRoute: (value: unknown) => { reported = value; } });
  const container = tree.props.children[0];
  const stack = container.props.children[0];
  assert.equal(stack.props.screenOptions.animation, 'default');
  assert.equal(stack.props.screenOptions.animationMatchesGesture, true);
  assert.equal(stack.props.screenOptions.gestureEnabled, true);
  assert.equal(stack.props.screenOptions.fullScreenGestureEnabled, false);
  assert.equal(stack.props.screenOptions.freezeOnBlur, true);
  assert.equal(reported, undefined); // a cancelled native gesture emits no committed navigation state
  container.props.onStateChange({ index: 0, routes: [{ params: { destination: { page: 'settings' } } }] });
  assert.deepEqual(reported, { page: 'settings' });
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('<EdgeBackSurface'), false);
  assert.equal(source.includes('<PageTransition'), false);
});

test('iOS uses the system push transition; Android keeps the light push', () => {
  const options = (os: string) => {
    const app = mountNavigator(os);
    const tree = app.component({ navigator: app.navigator, render: () => null, onRoute: () => {} });
    return tree.props.children[0].props.children[0].props.screenOptions;
  };
  assert.equal(options('ios').animation, 'default');
  assert.equal(options('android').animation, 'simple_push');
});
