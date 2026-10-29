// Expo's automatic plugins can add permissions even for packages excluded from autolinking.
// First delivery supports QR pairing; voice, Photos and biometric unlock are not exposed.
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withSupportedPrivacy(config) {
  return withInfoPlist(config, config => {
    for (const key of [
      'NSFaceIDUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSSpeechRecognitionUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) delete config.modResults[key];
    return config;
  });
};
