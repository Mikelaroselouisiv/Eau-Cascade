import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import {
  downloadAndInstallAndroidUpdate,
  inspectAndroidUpdate,
  isUnknownSourcesError,
  openUnknownSourcesSettings,
  type AndroidUpdateManifest,
} from '@/services/app-update';

type Phase = 'idle' | 'checking' | 'ready' | 'downloading' | 'installing' | 'current' | 'error';

/** Lien discret pour le pied de page du menu. */
export function AndroidUpdateCard() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [update, setUpdate] = useState<AndroidUpdateManifest | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setPhase('checking');
    setMessage(null);
    setUpdate(null);
    try {
      const result = await inspectAndroidUpdate();
      if (result.status === 'update') {
        setUpdate(result.manifest);
        setPhase('ready');
        return;
      }
      if (result.status === 'current') {
        setPhase('current');
        setMessage('Application à jour');
        return;
      }
      setPhase('error');
      setMessage(result.message);
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Vérification impossible');
    }
  }

  async function startUpdate() {
    if (!update) return;
    setPhase('downloading');
    setProgress(0);
    setMessage(null);
    try {
      await downloadAndInstallAndroidUpdate(update, (ratio, nextPhase) => {
        setProgress(ratio);
        setPhase(nextPhase);
      });
      setPhase('ready');
    } catch (err) {
      if (isUnknownSourcesError(err)) {
        setPhase('error');
        setMessage('Autorisez l’installation pour cette application, puis réessayez.');
        await openUnknownSourcesSettings().catch(() => undefined);
        return;
      }
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Mise à jour impossible');
    }
  }

  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing';
  const percent = Math.round(progress * 100);
  const actionLabel =
    phase === 'ready' && update
      ? `Mettre à jour vers ${update.version}`
      : 'Vérifier la mise à jour';

  return (
    <View style={styles.wrap}>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {phase === 'downloading' || phase === 'installing' ? (
        <Text style={styles.message}>
          {phase === 'installing' ? 'Installation…' : `Téléchargement ${percent} %`}
        </Text>
      ) : null}
      <Pressable
        onPress={() => void (phase === 'ready' ? startUpdate() : check())}
        disabled={busy}
        hitSlop={8}>
        {busy ? (
          <ActivityIndicator color={BrandColors.textMuted} size="small" />
        ) : (
          <Text style={styles.link}>{actionLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4, paddingTop: Spacing.one },
  link: { fontSize: 11, color: BrandColors.textMuted, textDecorationLine: 'underline' },
  message: { fontSize: 11, color: BrandColors.textMuted, textAlign: 'center' },
});
