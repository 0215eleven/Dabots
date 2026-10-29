// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
export interface ComposerControlsInput {
  hasDraft: boolean;
  busy: boolean;
  canStop: boolean;
  stopping: boolean;
  disabled: boolean;
  voiceAvailable: boolean;
}
export interface ComposerAction {
  mode: "send" | "stop" | "dictate";
  pressable: boolean;
  spinner: boolean;
  primed: boolean;
}

/** Which control the composer's action button is. DS Bot Mobile has no dictation, so it is send or stop. */
export function composerAction(input: ComposerControlsInput): ComposerAction {
  const empty = !input.hasDraft && !input.busy;
  if (empty && input.canStop) return { mode: "stop", pressable: !input.disabled && !input.stopping, spinner: input.stopping, primed: true };
  return { mode: "send", pressable: !input.disabled && !input.busy && input.hasDraft, spinner: input.busy, primed: input.hasDraft || input.busy };
}
