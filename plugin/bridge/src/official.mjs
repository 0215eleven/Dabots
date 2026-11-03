// The official relay and build key of Dabots release packages. A source checkout carries neither:
// release builds write them here from DABOTS_OFFICIAL_RELAY and DABOTS_BUILD_KEY
// (plugin/scripts/pack-suite.mjs), so a package built from this repository never uses the
// maintainers' server or pairs with their app unless the builder configures one.
export const OFFICIAL_RELAY = null
export const BUILD_KEY = null
