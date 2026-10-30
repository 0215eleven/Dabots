# iOS long-press preview follow-up

Base:9737e61. The user's screenshot shows a working native context menu below a
preview squeezed into a narrow vertical strip. No private screenshot or chat text
is included in this source change.

The installed Expo58 Link.Preview converts style width/height into a UIKit
preferredContentSize, rather than applying them as native host layout dimensions.
The old real content used flex sizing and the bubble used a percentage maximum,
leaving its initial layout dependent on the much narrower pinned trigger.

The shared preview hook now gives its root and both visible/measured bubbles
explicit matching geometry. Cached measurements are keyed to message/width/font
scale, new measurement contexts remount, invalid heights are ignored, and height
is bounded by the viewport. Both list and pinned call sites retain their native
Link.Menu, actions, preview navigation, accessibility and theme behavior.

Verification uses the actual production hook and installed Expo JS boundary:
four new checks failed against the base implementation and then passed, with the
existing empty/non-iOS behavior also passing. Mobile tests passed 342 Node and 11
Python checks with no failures or skips; mobile typecheck also passed. One independent scoped source review
found no concrete issue and verified the exact preserved upstream original and
provenance hashes. Detailed logs accompany the source delivery.

UIKit, native event timing, large Dynamic Type, landscape and final preview/menu
clipping still require an iPhone check. The tests use mocked React/native layout
components and cannot establish the exact screenshot symptom is resolved on a
device. No browser long-press result is presented as a native result. No native
build, IPA, release, main merge, credentials or cloud configuration change.
