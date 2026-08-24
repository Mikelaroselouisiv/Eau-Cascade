const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const PERMISSIONS = [
  { name: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_CONNECT' },
  { name: 'android.permission.BLUETOOTH_SCAN', neverForLocation: true },
  { name: 'android.permission.ACCESS_FINE_LOCATION', maxSdkVersion: '30' },
];

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function upsertPermission(manifest, spec) {
  const list = asArray(manifest['uses-permission']);
  const existing = list.find((item) => item.$?.['android:name'] === spec.name);
  const next = {
    $: {
      'android:name': spec.name,
      ...(spec.maxSdkVersion ? { 'android:maxSdkVersion': spec.maxSdkVersion } : {}),
      ...(spec.neverForLocation ? { 'android:usesPermissionFlags': 'neverForLocation' } : {}),
    },
  };
  if (existing) {
    existing.$ = { ...existing.$, ...next.$ };
  } else {
    list.push(next);
  }
  manifest['uses-permission'] = list;
}

module.exports = function withThermalPrinterBluetooth(config) {
  config = AndroidConfig.Permissions.withPermissions(
    config,
    PERMISSIONS.map((item) => item.name),
  );

  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    for (const spec of PERMISSIONS) {
      upsertPermission(manifest, spec);
    }
    return mod;
  });

  return withInfoPlist(config, (mod) => {
    mod.modResults.NSBluetoothAlwaysUsageDescription =
      mod.modResults.NSBluetoothAlwaysUsageDescription ||
      "Utilisé pour se connecter à l'imprimante de tickets.";
    mod.modResults.NSBluetoothPeripheralUsageDescription =
      "Utilisé pour se connecter à l'imprimante de tickets.";
    return mod;
  });
};
