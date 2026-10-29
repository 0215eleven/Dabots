
import { Image } from "expo-image";
import { type ReactNode, useId, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, FeColorMatrix, Filter, Image as SvgImage } from "react-native-svg";

import { DISCONNECTED_APPEARANCE } from "@/features/workspace/components/use-connection-appearance";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { savedAgentAvatar } from "@/features/workspace/model/agent-avatar-cache";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";

export interface AgentPhotoProps {
  agentId?: string;
  serverId?: string;
  imageUrl?: string | null;
  disconnected?: boolean;
}

export function AgentPhoto({
  agentId,
  serverId,
  imageUrl,
  disconnected = false,
  size,
  children,
}: AgentPhotoProps & { size: number; children: ReactNode }) {
  const avatarUrl = useMobileWorkspaceSelector(current => current.agents.find(agent => agent.id === agentId && agent.serverId === serverId)?.avatarUrl);
  // DS avatar images come from the canonical Bot, not an OpenBot avatar endpoint.
  const uri = imageUrl === undefined ? avatarUrl : imageUrl;
  const [failed, setFailed] = useState<string | null>(null);
  const filterId = `photo-offline-${useId().replaceAll(":", "")}`;
  return uri && uri !== failed ? (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      <Image
        source={{ uri }}
        contentFit="cover"
        recyclingKey={uri}
        style={{ width: size, height: size, opacity: disconnected ? 0 : 1 }}
        onError={() => setFailed(uri)}
      />
      {/* iOS does not support the native saturation style. Keep Expo's error handling
          and use the same SVG filter as generated avatars for the offline image. */}
      {disconnected ? (
        <Svg
          width={size}
          height={size}
          pointerEvents="none"
          style={{ position: "absolute" }}
          opacity={DISCONNECTED_APPEARANCE.opacity}
        >
          <Defs>
            <Filter id={filterId}>
              <FeColorMatrix type="saturate" values={[DISCONNECTED_APPEARANCE.saturation]} />
            </Filter>
          </Defs>
          <SvgImage
            href={{ uri }}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid slice"
            filter={`url(#${filterId})`}
          />
        </Svg>
      ) : null}
    </View>
  ) : (
    children
  );
}
