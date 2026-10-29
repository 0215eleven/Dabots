// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import React from "react";
import { BotAvatar } from "../../../../components/BotAvatar";
import { useSession } from "../../../../session/SessionProvider";

interface AvatarProps {
  agentId?: string;
  serverId?: string;
  hue?: unknown;
  seed?: string;
  size?: number;
  disconnected?: boolean;
  mood?: unknown;
  animateIdle?: boolean;
}

/** The OpenBot avatar slots draw this app's own Bot characters. */
export function BloubAvatar({ agentId, seed, size = 36, animateIdle = true }: AvatarProps) {
  const { workspace } = useSession();
  const id = agentId ?? seed ?? "bot";
  const bot = workspace.team.bots.find((entry) => entry.id === id || entry.sessionId === id) ?? { id, name: "" };
  return <BotAvatar bot={bot} size={size} animate={animateIdle} />;
}
export const BloubAvatarThumbnail = BloubAvatar;
export const BloubAvatarPreview = BloubAvatar;
