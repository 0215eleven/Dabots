// Cloud push is optional. Signing passwords and server credentials stay out of source.
// DS_BOT_NO_WIDGETS=1 builds the "lite" variant: no Live Activity extension, App Group or Dynamic Island,
// which free Apple IDs and some sideloading tools cannot sign.
const withoutWidgets = process.env.DS_BOT_NO_WIDGETS === '1';
const basePlugins = (config) => (config.plugins || []).filter((plugin) => !(withoutWidgets && (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-widgets'));
export default ({ config }) => ({
  ...config,
  // Mods run in reverse registration order; withLocalPersonalTeam is registered first so it strips the push
  // entitlement after expo-notifications has added it.
  plugins: ["./plugins/withLocalPersonalTeam.cjs", ...basePlugins(config), "./plugins/withTranslationInputs.cjs", "./plugins/withReleaseBuild.cjs", "./plugins/withLocalSceneLifecycle.cjs"],
  ios: {
    ...config.ios,
    bundleIdentifier: process.env.DS_BOT_IOS_BUNDLE_ID || config.ios?.bundleIdentifier || 'app.dsbot.mobile',
  },
  android: {
    ...config.android,
    ...(process.env.DS_BOT_ANDROID_VERSION_CODE ? { versionCode: Number(process.env.DS_BOT_ANDROID_VERSION_CODE) } : {}),
    ...(process.env.DS_BOT_GOOGLE_SERVICES_FILE ? {googleServicesFile:process.env.DS_BOT_GOOGLE_SERVICES_FILE} : {}),
  },
  extra: { ...config.extra, ...(process.env.DS_BOT_EAS_PROJECT_ID ? { eas: { projectId: process.env.DS_BOT_EAS_PROJECT_ID } } : {}) },
});
