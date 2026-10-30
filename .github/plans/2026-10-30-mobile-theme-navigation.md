# Mobile theme and navigation follow-up

Scope: retain the existing Bridge and homepage safe-area fix (431fcd8), repair theme propagation, and apply the user's latest navigation and pairing layout requests. No native build, release or main merge.

1. Reproduce the appearance boundary with the real app and isolated desktop fixture. Check navigation theme and underlying web canvas before changing code. Bind navigation and the system window/root background to the resolved DSH phone theme; keep normal bounce and transitions. Native iOS bounce and the supplied screenshot's apparent scaling remain device verification items.
2. Home: use the existing robot avatar at the left as the accessible settings button and the existing creation action at the right, with ordinary 44-point targets. Keep one MyBot title and manual safe-area padding. Do not implement the superseded right-swipe or floating-button proposal.
3. Pairing: inspect the actual rendered page, remove its large decorative robot, compact top spacing, and keep “Back to my computers” visible while retaining form scrolling, keyboard avoidance and safe areas. The separately referenced pairing image is not locally available; record that limit instead of claiming a visual comparison.
4. Verify each change through relevant tests and actual browser interaction (dark/light, short/long content, theme changes, safe areas, navigation, keyboard controls and pairing cancellation). Run the requested mobile typecheck and tests sequentially; preserve evidence and distinguish browser checks from native-device checks. Review the final diff, update upstream adaptation records, commit and push this feature branch normally.

Verified outcome: theme/navigation7, fresh Chinese8 and layout/pairing5 browser
checks passed; mobile typecheck and337 Node +11 Python tests passed. One scoped
independent review found no code issue. A real landscape-notch failure was repaired
with a RED→GREEN inset contract and actual CSS-safe-area verification. The original
top-inset fix remains. Native bounce/clipping/keyboard and an existing browser pinned
tile animation after repeated rotations remain explicitly unverified/unresolved in
`ios-app/docs/theme-navigation-review.md`. Commit/push state is reported separately.
