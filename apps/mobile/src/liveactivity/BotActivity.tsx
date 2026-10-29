import { HStack, Image, Text, VStack } from "@expo/ui/swift-ui";
import { font, foregroundStyle, lineLimit, padding } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";
import type { BotActivityState } from "./plan";

// Runs inside the widget extension (the 'widget' directive), so it can only use
// @expo/ui/swift-ui and the props below; keep it free of app imports and closures.
const symbol = (phase: string) => phase === "waiting" ? "questionmark.bubble.fill" : phase === "done" ? "checkmark.circle.fill" : phase === "offline" ? "wifi.slash" : "sparkles";
const label = (phase: string) => phase === "waiting" ? "Waiting for you" : phase === "done" ? "Done" : phase === "offline" ? "Computer offline" : "Working";

function BotActivity(props: BotActivityState, environment: { isStale?: boolean }) {
  "widget";
  const phase = environment.isStale && props.phase === "running" ? "offline" : props.phase;
  const detail = props.detail || label(phase);
  return {
    banner: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 14 })]}>
        <HStack spacing={8}>
          <Image systemName={symbol(phase)} />
          <Text modifiers={[font({ weight: "semibold", size: 16 }), lineLimit(1)]}>{props.title}</Text>
        </HStack>
        <Text modifiers={[font({ size: 14 }), foregroundStyle({ type: "hierarchical", style: "secondary" }), lineLimit(2)]}>{detail}</Text>
      </VStack>
    ),
    compactLeading: <Image systemName={symbol(phase)} />,
    compactTrailing: <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{props.count > 1 ? String(props.count) : label(phase)}</Text>,
    minimal: <Image systemName={symbol(phase)} />,
    expandedLeading: <Image systemName={symbol(phase)} modifiers={[padding({ all: 6 })]} />,
    expandedCenter: <Text modifiers={[font({ weight: "semibold", size: 16 }), lineLimit(1)]}>{props.title}</Text>,
    expandedBottom: <Text modifiers={[font({ size: 13 }), foregroundStyle({ type: "hierarchical", style: "secondary" }), lineLimit(2)]}>{detail}</Text>,
  };
}

export default createLiveActivity<BotActivityState>("BotActivity", BotActivity);
