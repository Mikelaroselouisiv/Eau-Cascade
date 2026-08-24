import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import {
  checkForAndroidUpdate,
  downloadAndInstallAndroidUpdate,
  installLocalAndroidApk,
  isUnknownSourcesError,
  openUnknownSourcesSettings,
  type AndroidUpdateManifest,
} from '@/services/app-update';

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type PromptPhase = 'idle' | 'ready' | 'downloading' | 'installing' | 'permission' | 'error';

export function AndroidUpdatePrompt() {
  const checking = useRef(false);
  const lastCheckAt = useRef(0);
  const dismissedVersionCode = useRef<number | null>(null);
  const pendingInstall = useRef(false);

  const [update, setUpdate] = useState<AndroidUpdateManifest | null>(null);
  const [phase, setPhase] = useState<PromptPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function check(force = false) {
      const now = Date.now();
      if (checking.current || (!force && now - lastCheckAt.current < RECHECK_INTERVAL_MS)) {
        return;
      }
      checking.current = true;
      lastCheckAt.current = now;
      try {
        const next = await checkForAndroidUpdate();
        if (!mounted || !next || dismissedVersionCode.current === next.versionCode) return;
        setUpdate(next);
        setPhase((current) => (current === 'idle' ? 'ready' : current));
      } finally {
        checking.current = false;
      }
    }

    async function onAppStateChange(state: AppStateStatus) {
      if (state !== 'active') return;
      if (pendingInstall.current) {
        pendingInstall.current = false;
        try {
          setPhase('installing');
          await installLocalAndroidApk();
          setPhase('ready');
        } catch (err) {
          setPhase('error');
          setError(
            err instanceof Error ? err.message : 'Installation impossible. Réessayez.',
          );
        }
        return;
      }
      void check();
    }

    void check(true);
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  async function startUpdate() {
    if (!update) return;
    setError(null);
    setProgress(0);
    setPhase('downloading');
    try {
      await downloadAndInstallAndroidUpdate(update, (ratio, nextPhase) => {
        setProgress(ratio);
        setPhase(nextPhase);
      });
      setPhase('ready');
    } catch (err) {
      if (isUnknownSourcesError(err)) {
        setPhase('permission');
        return;
      }
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Mise à jour impossible. Réessayez.');
    }
  }

  async function allowUnknownSources() {
    pendingInstall.current = true;
    try {
      await openUnknownSourcesSettings();
    } catch {
      pendingInstall.current = false;
      setPhase('error');
      setError('Impossible d’ouvrir les réglages Android.');
    }
  }

  function dismiss() {
    if (update?.mandatory || phase === 'downloading' || phase === 'installing') return;
    dismissedVersionCode.current = update?.versionCode ?? null;
    setUpdate(null);
    setPhase('idle');
    setError(null);
  }

  const visible = update != null && phase !== 'idle';
  if (!visible || !update) return null;

  const percent = Math.round(progress * 100);
  const busy = phase === 'downloading' || phase === 'installing';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {update.mandatory ? 'Mise à jour requise' : 'Mise à jour disponible'}
          </Text>
          <Text style={styles.body}>
            La version {update.version} est prête. Un tap suffit : l’app télécharge, puis Android
            demande « Installer ».
          </Text>
          {update.notes?.trim() ? <Text style={styles.notes}>{update.notes.trim()}</Text> : null}

          {phase === 'downloading' || phase === 'installing' ? (
            <View style={styles.progressBlock}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${percent}%` }]} />
              </View>
              <Text style={styles.meta}>
                {phase === 'installing'
                  ? 'Ouverture de l’installateur Android…'
                  : `Téléchargement… ${percent} %`}
              </Text>
            </View>
          ) : null}

          {phase === 'permission' ? (
            <Text style={styles.warn}>
              Autorisez une fois « Installer des applis inconnues » pour cette application, puis
              revenez. Android l’exige hors Play Store.
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            {phase === 'permission' ? (
              <Pressable style={styles.primary} onPress={() => void allowUnknownSources()}>
                <Text style={styles.primaryText}>Autoriser l’installation</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.primary, busy && styles.disabled]}
                disabled={busy}
                onPress={() => void startUpdate()}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryText}>
                    {phase === 'error' ? 'Réessayer' : 'Mettre à jour'}
                  </Text>
                )}
              </Pressable>
            )}
            {!update.mandatory && !busy ? (
              <Pressable style={styles.secondary} onPress={dismiss}>
                <Text style={styles.secondaryText}>Plus tard</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 25, 23, 0.45)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 16,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: BrandColors.text },
  body: { fontSize: 15, lineHeight: 22, color: BrandColors.text },
  notes: { fontSize: 13, color: BrandColors.textMuted },
  meta: { fontSize: 13, color: BrandColors.textMuted },
  warn: { fontSize: 14, lineHeight: 20, color: BrandColors.primaryHover },
  error: { fontSize: 14, color: BrandColors.danger, fontWeight: '600' },
  progressBlock: { gap: 8 },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: BrandColors.bgDeep,
    overflow: 'hidden',
  },
  fill: { height: 8, backgroundColor: BrandColors.primary },
  actions: { gap: Spacing.two },
  primary: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { color: BrandColors.textMuted, fontWeight: '600' },
  disabled: { opacity: 0.7 },
});
