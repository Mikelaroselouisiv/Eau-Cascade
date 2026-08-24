const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';
const VIEW_ACTION = 'android.intent.action.VIEW';
const APK_MIME = 'application/vnd.android.package-archive';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hasApkInstallQuery(manifest) {
  return asArray(manifest.queries).some((block) =>
    asArray(block.intent).some((intent) => {
      const hasView = asArray(intent.action).some((item) => item.$?.['android:name'] === VIEW_ACTION);
      const hasApk = asArray(intent.data).some((item) => item.$?.['android:mimeType'] === APK_MIME);
      return hasView && hasApk;
    }),
  );
}

/**
 * Autorise l’installation d’une APK téléchargée dans l’app (Android 8+).
 * Le dialogue système « Installer ? » reste obligatoire.
 */
module.exports = function withAndroidApkInstall(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [PERMISSION]);
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    if (!hasApkInstallQuery(manifest)) {
      const queries = asArray(manifest.queries);
      queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': VIEW_ACTION } }],
            data: [{ $: { 'android:mimeType': APK_MIME } }],
          },
        ],
      });
      manifest.queries = queries;
    }
    return mod;
  });
};
