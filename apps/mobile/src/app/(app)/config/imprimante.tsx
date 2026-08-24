import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppScrollView } from '@/components/AppScrollView';
import { Screen } from '@/components/Screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  clearSavedPrinter,
  getLocalPaperWidth,
  getSavedPrinter,
  printReceipt,
  requestBluetoothPermissions,
  savePaperWidth,
  saveSelectedPrinter,
  startPrinterScan,
  stopPrinterScan,
  subscribePrinterScan,
  type SavedPrinter,
  type ThermalPrinterDevice,
} from '@/services/bluetooth-printer';
import { buildSaleReceiptData } from '@/services/receipt';

const SCAN_MS = 8000;

export default function PrinterSettingsScreen() {
  const { user } = useAuth();
  const departmentId = typeof user?.departmentId === 'number' ? user.departmentId : undefined;

  const [devices, setDevices] = useState<ThermalPrinterDevice[]>([]);
  const [saved, setSaved] = useState<SavedPrinter | null>(null);
  const [paperWidth, setPaperWidthState] = useState<58 | 80>(58);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refreshSaved = useCallback(() => {
    getSavedPrinter().then(setSaved).catch(() => undefined);
    getLocalPaperWidth().then(setPaperWidthState).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  useEffect(() => {
    return subscribePrinterScan(
      (device) => {
        setDevices((prev) => {
          const next = prev.filter((item) => item.id !== device.id);
          next.push(device);
          return next.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
        });
      },
      () => {
        setScanning(false);
        setStatus((current) =>
          current?.startsWith('Recherche') ? 'Recherche terminée' : current,
        );
      },
    );
  }, []);

  useEffect(() => {
    return () => {
      stopPrinterScan().catch(() => undefined);
    };
  }, []);

  async function scan() {
    setScanning(true);
    setStatus(null);
    setDevices([]);
    try {
      const granted = await requestBluetoothPermissions();
      if (!granted) {
        setScanning(false);
        setStatus('Permissions Bluetooth refusées');
        return;
      }
      await startPrinterScan(SCAN_MS);
      setStatus(
        Platform.OS === 'ios'
          ? 'Recherche BLE… allumez l’imprimante et rapprochez-la'
          : 'Recherche Bluetooth… les appareils appairés apparaissent en premier',
      );
      setTimeout(() => {
        setScanning((still) => {
          if (still) {
            stopPrinterScan().catch(() => undefined);
            setStatus((current) =>
              current?.startsWith('Recherche') ? 'Recherche terminée' : current,
            );
          }
          return false;
        });
      }, SCAN_MS + 500);
    } catch (error) {
      setScanning(false);
      setStatus(error instanceof Error ? error.message : 'Impossible de lancer la recherche Bluetooth');
    }
  }

  async function selectDevice(device: ThermalPrinterDevice) {
    setScanning(false);
    stopPrinterScan().catch(() => undefined);
    await saveSelectedPrinter({
      address: device.id,
      name: device.name,
      transport: device.transport,
    });
    refreshSaved();
    setStatus(`Imprimante enregistrée : ${device.name ?? device.id}`);
  }

  async function setPaperWidth(width: 58 | 80) {
    setPaperWidthState(width);
    try {
      await savePaperWidth(width);
      setStatus(`Largeur papier : ${width} mm`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Impossible d’enregistrer la largeur papier');
    }
  }

  async function forgetPrinter() {
    await clearSavedPrinter();
    refreshSaved();
    setStatus('Imprimante oubliée');
  }

  async function testPrint() {
    setTesting(true);
    setStatus(null);
    try {
      const receiptData = await buildSaleReceiptData({
        items: [],
        total: 0,
        paymentMode: 'CASH',
        cashier: user?.fullName || user?.phone,
        departmentId,
        isTest: true,
      });
      await printReceipt({
        ...receiptData,
        previewSampleBody: receiptData.previewSampleBody || 'Ticket de test',
      });
      setStatus('Ticket test envoyé');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Échec de l'impression Bluetooth");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Screen>
      <AppScrollView padded contentStyle={styles.content}>
        {status && (
          <ThemedView type="backgroundElement" style={styles.status}>
            <ThemedText type="small">{status}</ThemedText>
          </ThemedView>
        )}

        <View style={styles.section}>
          <ThemedText type="smallBold">Imprimante actuelle</ThemedText>
          <ThemedText themeColor="textSecondary">
            {saved
              ? `${saved.name ?? 'Sans nom'} (${saved.address})`
              : 'Aucune imprimante configurée'}
          </ThemedText>
          {saved ? (
            <ThemedText type="small" themeColor="textSecondary">
              {saved.transport === 'ble' ? 'Bluetooth Low Energy (iOS)' : 'Bluetooth Classic (Android)'}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Largeur papier
          </ThemedText>
          <View style={styles.row}>
            {([58, 80] as const).map((width) => (
              <Pressable
                key={width}
                onPress={() => setPaperWidth(width)}
                style={[styles.widthButton, paperWidth === width && styles.widthButtonActive]}>
                <ThemedText>{width}mm</ThemedText>
              </Pressable>
            ))}
          </View>
        </View>

        <ThemedText type="small" themeColor="textSecondary">
          {Platform.OS === 'ios'
            ? 'Cette imprimante n’apparaît pas dans Réglages iOS, c’est normal. Allumez-la, lancez la recherche ici, puis imprimez. Si un popup Bluetooth s’affiche, annulez-le — aucun code n’est nécessaire.'
            : 'Sur Android, appairez d’abord l’imprimante dans les réglages Bluetooth du téléphone, ou lancez une recherche ici.'}
        </ThemedText>

        <Pressable style={styles.button} onPress={scan} disabled={scanning}>
          {scanning ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText style={styles.buttonText}>Rechercher une imprimante</ThemedText>
          )}
        </Pressable>

        <View style={styles.deviceList}>
          {devices.length === 0 ? (
            <ThemedText themeColor="textSecondary" style={styles.emptyList}>
              {scanning ? 'Recherche en cours…' : 'Aucun appareil pour le moment'}
            </ThemedText>
          ) : (
            devices.map((item) => (
              <Pressable key={item.id} style={styles.deviceRow} onPress={() => selectDevice(item)}>
                <ThemedText>{item.name || 'Sans nom'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.id}
                  {item.rssi != null ? `  ·  ${item.rssi} dBm` : ''}
                </ThemedText>
              </Pressable>
            ))
          )}
        </View>

        <Pressable
          style={[styles.button, styles.testButton, (!saved || testing) && styles.buttonDisabled]}
          onPress={testPrint}
          disabled={!saved || testing}>
          {testing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText style={styles.buttonText}>Ticket test</ThemedText>
          )}
        </Pressable>

        {saved ? (
          <Pressable style={styles.secondaryButton} onPress={forgetPrinter}>
            <ThemedText style={styles.secondaryButtonText}>Oublier cette imprimante</ThemedText>
          </Pressable>
        ) : null}
      </AppScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, paddingBottom: Spacing.six },
  status: { padding: Spacing.two, borderRadius: Spacing.two },
  section: { gap: Spacing.one },
  sectionTitle: { marginBottom: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two },
  widthButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    alignItems: 'center',
  },
  widthButtonActive: {
    backgroundColor: BrandColors.primarySoft,
    borderColor: BrandColors.primary,
  },
  button: {
    backgroundColor: BrandColors.primary,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  testButton: { marginTop: Spacing.two },
  secondaryButton: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
  },
  secondaryButtonText: { color: BrandColors.text, fontWeight: '600' },
  deviceList: { gap: 0 },
  deviceRow: {
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BrandColors.border,
  },
  emptyList: { paddingVertical: Spacing.four, textAlign: 'center' },
});
