// DS Bot Mobile drawer content, laid out as OpenBot's server drawer (PolyForm Noncommercial 1.0.0, see ../../../LICENSE).
// The computers, tools and footer are DS Bot's: paired computers, the team and host pages, this phone.
import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import Calendar from "lucide-react-native/icons/calendar";
import ChartColumn from "lucide-react-native/icons/chart-column";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import Plus from "lucide-react-native/icons/plus";
import Settings from "lucide-react-native/icons/settings";
import Settings2 from "lucide-react-native/icons/settings-2";
import Smartphone from "lucide-react-native/icons/smartphone";
import UsersRound from "lucide-react-native/icons/users-round";
import { memo, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { tr } from "../../../../i18n";
import { hostAddress } from "../../../../logic/hosts";
import type { Route } from "../../../../logic/app-navigation";
import { useSession } from "../../../../session/SessionProvider";
import type { Host } from "../../../../storage";
import { ProfileAvatar } from "@legacy/shared/components/profile-avatar";
import { haptics } from "@legacy/shared/lib/haptics";
import { useReducedMotion } from "@legacy/shared/lib/motion";
import { typeScale } from "@legacy/shared/lib/type-scale";
import { ServerDrawerIconButton } from "./server-drawer-icon-button";

const DRAWER_ROW_HEIGHT = 46;
const SERVER_ROW_HEIGHT = 56;
const classic = (route: Route): Href => ({ pathname: "/classic", params: { open: JSON.stringify(route) } });

interface ServerDrawerContentProps {
  muted: ViewStyle["backgroundColor"];
  /** True after the drawer has opened. */
  open: boolean;
  topInset: number;
  onNavigate: (href: Href) => void;
  onClose: () => void;
}

export const ServerDrawerContent = memo(function ServerDrawerContent({ muted, open, topInset, onNavigate, onClose }: ServerDrawerContentProps) {
  const session = useSession();
  const reducedMotion = useReducedMotion();
  const mutedColor = String(muted);
  const [listOpen, setListOpen] = useState(false);
  const active = session.host;
  useEffect(() => {
    if (!open) setListOpen(false);
  }, [open]);
  const showsList = listOpen || !active;
  const subtitle = active ? `${hostAddress(active)} · ${session.workspace.online ? tr("Connected") : tr("Connecting…")}` : null;

  const select = (host: Host) => {
    void haptics.selection();
    if (active && host.serverId === active.serverId) return;
    void session.switchHost(host).then((ok) => { if (ok) onClose(); });
  };
  const forget = (host: Host) => {
    if (active && host.serverId === active.serverId) return;
    void haptics.longPress();
    Alert.alert(tr("Forget {p0}?", { p0: host.name }), undefined, [
      { text: tr("Cancel"), style: "cancel" },
      { text: tr("Forget"), style: "destructive", onPress: () => void session.forgetHost(host) },
    ]);
  };

  return (
    <>
      <View className="pr-3 pb-1" style={{ paddingTop: Math.max(topInset, 16) }}>
        <View className="min-h-14 flex-row items-center justify-between gap-2 pl-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={active?.name ?? tr("Computers")}
            accessibilityState={{ expanded: showsList }}
            className="min-w-0 shrink flex-row items-center gap-1"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            onPress={() => { void haptics.selection(); setListOpen((current) => !current); }}
          >
            <Typography.Heading className="font-bold shrink" numberOfLines={1} style={typeScale.drawerTitle}>
              {active?.name ?? tr("Computers")}
            </Typography.Heading>
            <Animated.View
              style={{
                marginTop: 3,
                transform: [{ rotate: showsList ? "180deg" : "0deg" }],
                transitionProperty: "transform",
                transitionDuration: reducedMotion ? 0 : 240,
                transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
              }}
            >
              <ChevronDown color={mutedColor} size={20} strokeWidth={2.4} />
            </Animated.View>
          </Pressable>
          <ServerDrawerIconButton accessibilityLabel={tr("Pair a computer")} color={mutedColor} fallbackVariant="filled" systemName="plus" onPress={() => onNavigate("/pairing")}>
            <Plus color={mutedColor} size={18} strokeWidth={2} />
          </ServerDrawerIconButton>
        </View>
        {subtitle ? (
          <Typography.Paragraph className="-mt-1.5 px-3 text-text-secondary" numberOfLines={1} style={typeScale.caption}>
            {subtitle}
          </Typography.Paragraph>
        ) : null}
      </View>

      <ScrollView className="flex-1" contentContainerClassName="pt-1 pr-3 pb-4" contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}>
        {showsList ? (
          <View>
            {session.hosts.map((host) => {
              const selected = !!active && host.serverId === active.serverId;
              return (
                <Pressable
                  key={host.slot || host.serverId}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={host.name}
                  className={`flex-row items-center gap-3 rounded-2xl px-2.5 ${selected ? "bg-control" : ""}`}
                  onPress={() => select(host)}
                  onLongPress={() => forget(host)}
                  style={({ pressed }) => ({ height: SERVER_ROW_HEIGHT - 4, marginBottom: 4, opacity: pressed ? 0.58 : 1 })}
                >
                  <ProfileAvatar name={host.name} size={40} />
                  <View className="min-w-0 flex-1">
                    <Typography.Paragraph className="font-medium" numberOfLines={1} style={typeScale.rowTitle}>{host.name}</Typography.Paragraph>
                    <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.caption}>{hostAddress(host)}</Typography.Paragraph>
                  </View>
                </Pressable>
              );
            })}
            {active ? <DrawerDivider /> : null}
          </View>
        ) : null}

        {active ? (
          <View className="pt-1.5">
            <DrawerRow icon={UsersRound} label={tr("Bots")} href={classic({ page: "team", section: "bots" })} onNavigate={onNavigate} />
            {session.workspace.team.mobileCapabilities?.groups === false ? null : (
              <DrawerRow icon={MessagesSquare} label={tr("Group chats")} href={classic({ page: "team", section: "groups" })} onNavigate={onNavigate} />
            )}
            <DrawerRow icon={Calendar} label={tr("Scheduled tasks")} href={classic({ page: "settings", initial: "schedules" })} onNavigate={onNavigate} />
            <DrawerRow icon={ChartColumn} label={tr("Usage")} href={classic({ page: "settings", initial: "usage" })} onNavigate={onNavigate} />
            <DrawerRow icon={Smartphone} label={tr("Mobile devices")} href={classic({ page: "settings", initial: "mobile" })} onNavigate={onNavigate} />
            <DrawerDivider />
            <DrawerRow icon={Settings2} label={tr("Computer settings")} href={classic({ page: "settings" })} onNavigate={onNavigate} />
          </View>
        ) : null}
      </ScrollView>

      <View className="mr-3 flex-row items-center gap-2 pt-2">
        <View className="min-h-14 min-w-0 flex-1 flex-row items-center gap-2.5 rounded-2xl px-2 py-2">
          <ProfileAvatar neutral name={tr("This phone")} size={36} />
          <View className="min-w-0 flex-1">
            <Typography.Paragraph className="font-semibold" numberOfLines={1} style={typeScale.preview}>{tr("This phone")}</Typography.Paragraph>
            <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.small}>
              {tr("{p0} computers paired", { p0: String(session.hosts.length) })}
            </Typography.Paragraph>
          </View>
        </View>
        <ServerDrawerIconButton accessibilityLabel={tr("Settings")} color={mutedColor} systemName="gearshape" onPress={() => onNavigate("/settings")}>
          <Settings color={mutedColor} size={18} strokeWidth={1.8} />
        </ServerDrawerIconButton>
      </View>
    </>
  );
});

function DrawerDivider() {
  return <View accessibilityElementsHidden className="mx-2.5 mt-2.5 mb-1 h-px bg-grouped-border" />;
}

const DrawerRow = memo(function DrawerRow({ icon: Icon, label, href, onNavigate }: { icon: LucideIcon; label: string; href: Href; onNavigate: (href: Href) => void }) {
  const [secondary, control] = useCSSVariable(["--openbot-text-secondary", "--openbot-bg-control"]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-3 rounded-2xl px-3"
      style={({ pressed }) => ({ height: DRAWER_ROW_HEIGHT, backgroundColor: pressed ? String(control) : undefined })}
      onPress={() => { void haptics.impact("soft"); onNavigate(href); }}
    >
      <Icon color={String(secondary)} size={20} strokeWidth={1.8} />
      <Typography.Paragraph className="min-w-0 flex-1" numberOfLines={1} style={typeScale.rowTitle}>{label}</Typography.Paragraph>
    </Pressable>
  );
});
