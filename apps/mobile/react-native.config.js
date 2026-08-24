/** APK in-app update is Android-only. Linking ExpoFileSystem on iOS crashes at dyld. */
module.exports = {
  dependencies: {
    'expo-file-system': { platforms: { ios: null } },
    'expo-intent-launcher': { platforms: { ios: null } },
  },
};
