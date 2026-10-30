# Mobile appearance and navigation follow-up

Base: `431fcd8`. This change keeps the existing DSH Bridge, capability checks,
model source, identities, licenses and lite iOS build scope.

## Changes and evidence

- The real app in manual dark mode on a light system had transparent web
  document/body backgrounds and a light navigation theme. Its Bot form header
  was visibly white. The root now supplies the resolved DS palette to the
  navigation provider and Expo SystemUI. The installed Expo58 Swift module sets
  both UIWindow and root-controller backgrounds; native execution is unverified.
- The home settings action is the existing pixel robot at the left, with the
  existing creation menu at the right. Both have real 44-point targets and
  accessible names. Keyboard settings/menu navigation and both home routes were
  exercised. No right-swipe gesture or floating action was added.
- Home retains manual top/bottom safe-area ownership and disabled automatic
  content insets. A failing landscape-notch check identified missing lateral
  clearance; the same content container now consumes left/right insets once.
- At 390×844 the old pairing return action began at y1011, outside the initial
  viewport. The large robot decoration and centered 42-point top spacing are
  removed. Return stays above the bounded scrolling form, disabled while pairing
  waits. Cancel pairing and keyboard activation of return preserve the existing
  computer. The scroll view handles keyboard insets; the route still owns the
  top inset, and content clears bottom/lateral safe areas.

## Verification

Final checks: mobile typecheck passed;337 Node tests and11 Python tests passed
with no failures or skips. The real-host theme/navigation scenario passed7 checks,
fresh Chinese interaction passed8, and four CSS safe-area profiles plus pairing
passed5. These counts include each scenario's own initial pairing check.

One scoped independent source review found no Critical/Important/Minor issue.
The subsequent lateral-safe-area correction has a failing browser/unit reproduction
and passing targeted/full mobile verification. No second broad review was started.

Run from `ios-app/`, with the normal preview-disabled Metro on localhost:8093:

```sh
npm run typecheck
npm test
DS_TEST_SCENARIO=theme-navigation node test/browser/ds-isolated-host.cjs
DS_TEST_SCENARIO=chinese node test/browser/ds-isolated-host.cjs
```

The delivered run selects Dark through real phone settings for the Chinese
scenario. Screenshots contain only disposable public DSH fixture data and no
pairing tickets. The layout driver uses actual browser CSS safe-area overrides
and reads the mounted list's inset props; it does not simulate UIKit.

The theme/navigation scenario covers manual Dark on a light system, manual Light
on a dark system, System changes, canonical DSH Paper/DeepSeek palette changes,
short/long content scrolling, both creation forms, Chinese/English round trips,
and pairing return/wait/cancel at 390×844, 375×667 and 844×390. The native-window
boundary test executes the actual root with the public SystemUI call observed;
it is not a native module/device execution test.

The screenshot set and detailed command logs are delivered separately. Existing
React Native Web DOM-prop warnings remain. A provisional submission receipt 404
is handled by the existing `confirmOrSubmit` lookup-before-submit path; the browser
records it without an uncaught error.

## Limits and retained evidence

- Xcode, IPA packaging, physical iPhone bounce, interactive native transitions,
  keyboard avoidance and Dynamic Type were not executed in this pass. The user's
  supplied image shows a pale surround and apparent scaling/clipping; its exact
  system/app transition is unidentified and cannot be declared repaired from
  browser checks. Normal bounce/animations remain enabled.
- A combined stress attempt (repeated viewport rotations followed by the Chinese
  flow) hid a pinned tile in the browser's existing layout animation. The same
  empty pinned region appears in the previous431fcd8 landscape evidence. That
  browser animation issue is outside this repair and remains recorded. Fresh
  Chinese interaction and the four layout profiles were verified separately;
  the failed combined run is retained, not reported as passing.
- The separately referenced pairing inspiration image was unavailable locally.
  The actual current pairing screen was inspected before/after; no pixel comparison
  against that unavailable reference is claimed.
- No native build, release, main merge, signing or cloud configuration change.
