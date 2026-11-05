// Expo's automatic plugins can add permissions even for packages excluded from autolinking.
// QR pairing and selected photo attachments are exposed; voice and biometric unlock are not.
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withSupportedPrivacy(config) {
  return withInfoPlist(config, config => {
    for (const key of [
      'NSFaceIDUsageDescription',
      'NSMicrophoneUsageDescription',
      'NSSpeechRecognitionUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) delete config.modResults[key];
    return config;
  });
};
