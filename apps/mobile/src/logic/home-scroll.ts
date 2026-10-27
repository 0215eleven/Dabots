// ScrollView.contentOffset is an initial/restoration command, not live state.
// Keep its object/value stable during native drag and momentum events.
/** `top` is where a fresh list rests: below a search field it keeps above the fold. */
export function createHomeScrollRestoration(top = 0) {
  let saved = top;
  let offset = { x: 0, y: top };
  return {
    get initialOffset() { return offset; },
    observe(y: number) { if (Number.isFinite(y)) saved = Math.max(0, y); },
    restore() { offset = { x: 0, y: saved }; return offset; },
    reset() { saved = top; offset = { x: 0, y: top }; },
  };
}
