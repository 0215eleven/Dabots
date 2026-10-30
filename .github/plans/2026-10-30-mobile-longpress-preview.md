# iOS long-press preview repair

Base9737e61. The user supplied a native screenshot of a pinned Bot context menu
whose preview content is squeezed into a narrow vertical strip.

1. Trace the actual Expo58 preview contract and the pinned/list call sites. Keep
   native Link.Menu, its actions and normal chat navigation.
2. Add failing actual-hook/installed-SDK boundary tests. Give the content and its
   hidden measurement the same independent width, discard measurements after
   content/viewport/font changes, and bound invalid or excessive height.
3. Preserve the exact upstream original and update provenance. Run the focused
   regression, mobile checks sequentially and one scoped review. Commit/push the
   same feature branch. Native context-menu behavior still needs an iPhone run;
   browser tests cannot validate UIKit. Do not build or publish an IPA.

Verified: four RED failures became GREEN; five focused checks,342 mobile Node
tests,11 Python tests and mobile typecheck passed. One scoped review found no
concrete issue and checked provenance. iPhone long-press appearance remains
unverified. Commit/push state is reported separately.
