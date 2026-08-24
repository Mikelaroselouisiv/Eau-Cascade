const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_CONFIG = `
        release {
            def releaseStorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (releaseStorePath) {
                storeFile file(releaseStorePath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            } else {
                // Build local installable; CI de publication fournit toujours la cle release.
                initWith signingConfigs.debug
            }
        }`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') return gradleConfig;

    let source = gradleConfig.modResults.contents;
    if (!source.includes('releaseStorePath = System.getenv("ANDROID_KEYSTORE_PATH")')) {
      const debugSigningBlock =
        /(\s+debug\s*\{\s*storeFile file\('debug\.keystore'\)\s*storePassword 'android'\s*keyAlias 'androiddebugkey'\s*keyPassword 'android'\s*\})/m;
      if (!debugSigningBlock.test(source)) {
        throw new Error('Bloc signingConfigs.debug Android introuvable');
      }
      source = source.replace(debugSigningBlock, `$1${SIGNING_CONFIG}`);
    }

    const releaseBlock =
      /(release\s*\{\s*\/\/ Caution![\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseBlock.test(source)) {
      throw new Error('Bloc buildTypes.release Android introuvable');
    }
    source = source.replace(releaseBlock, '$1signingConfig signingConfigs.release');
    gradleConfig.modResults.contents = source;
    return gradleConfig;
  });
};
