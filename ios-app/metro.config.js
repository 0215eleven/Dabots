const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const config = getDefaultConfig(__dirname);
// The SDK is a local file dependency shared with the host's protocol tests.
config.watchFolders = [path.resolve(__dirname, "./sdk")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
// The OpenBot avatars use bloub's DOM-free BotEngine; its Solid UI layer is replaced by shims (src/openbot/shims).
const shims = new Map([
  ["@solidjs/web", path.resolve(__dirname, "src/openbot/shims/solidjs-web.ts")],
  ["solid-js", path.resolve(__dirname, "src/openbot/shims/solid-js.ts")],
  // The engine-only build on every platform; the web "browser" build needs Solid's DOM renderer.
  ["@norbert_bodziony/bloub", path.resolve(__dirname, "node_modules/@norbert_bodziony/bloub/dist/package/server.js")],
]);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shim = shims.get(moduleName);
  if (shim) return { filePath: shim, type: "sourceFile" };
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
