// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import { Image } from "expo-image";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useMobileWorkspaceSelector } from "@legacy/features/workspace/context/mobile-workspace-context";

export interface AgentPhotoProps {
  agentId?: string;
  serverId?: string;
  imageUrl?: string | null;
  disconnected?: boolean;
}

/** A photo the owner set for the Bot in DS Bot, else the generated avatar (`children`). */
export function AgentPhoto({ agentId, imageUrl, disconnected = false, size, children }: AgentPhotoProps & { size: number; children: ReactNode }) {
  const photo = useMobileWorkspaceSelector((current) =>
    imageUrl === undefined ? current.agents.find((candidate) => candidate.id === agentId)?.bot?.avatar?.image : imageUrl,
  );
  const [failed, setFailed] = useState<string | null>(null);
  return photo && photo !== failed ? (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", opacity: disconnected ? 0.5 : 1 }}>
      <Image source={{ uri: photo }} contentFit="cover" recyclingKey={photo} style={{ width: size, height: size }} onError={() => setFailed(photo)} />
    </View>
  ) : (
    children
  );
}
