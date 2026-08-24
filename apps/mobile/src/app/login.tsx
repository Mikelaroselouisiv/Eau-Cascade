import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScrollView } from '@/components/AppScrollView';
import { BrandLogo } from '@/components/BrandLogo';
import { Screen } from '@/components/Screen';
import { BRAND_NAME, BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { isLikelyNetworkError } from '@/services/api-errors';

export default function LoginScreen() {
  const { user, loading, login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <Screen edges="full" backgroundColor={BrandColors.bg}>
        <View style={styles.loading}>
          <ActivityIndicator color={BrandColors.primary} size="large" />
        </View>
      </Screen>
    );
  }

  if (user) return <Redirect href="/(app)" />;

  async function handleSubmit() {
    if (!phone.trim() || !password) {
      setError('Téléphone et mot de passe requis');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(phone.trim(), password);
    } catch (e) {
      setError(
        isLikelyNetworkError(e)
          ? 'Connexion au serveur impossible — vérifiez le réseau'
          : 'Identifiants invalides',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen edges="full" keyboard backgroundColor={BrandColors.bg}>
      <View style={styles.atmosphere} pointerEvents="none">
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>

      <AppScrollView contentStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.brand}>
            <BrandLogo height={64} />
            <Text style={styles.brandName}>{BRAND_NAME.toUpperCase()}</Text>
            <Text style={styles.subtitle}>Connexion au point de vente</Text>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Téléphone"
            placeholderTextColor={BrandColors.textMuted}
            keyboardType="phone-pad"
            autoCapitalize="none"
            returnKeyType="next"
            value={phone}
            onChangeText={setPhone}
          />
          <TextInput
            style={styles.input}
            placeholder="Mot de passe"
            placeholderTextColor={BrandColors.textMuted}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              submitting && styles.buttonDisabled,
              pressed && !submitting && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
            disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>Se connecter</Text>
            )}
          </Pressable>
        </View>
      </AppScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atmosphere: {
    ...StyleSheet.absoluteFill,
  },
  glowTop: {
    position: 'absolute',
    top: -60,
    left: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255, 140, 0, 0.14)',
  },
  glowBottom: {
    position: 'absolute',
    right: -70,
    bottom: 80,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(230, 126, 0, 0.1)',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.four,
    gap: Spacing.three,
    shadowColor: '#1C1917',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  brand: {
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  brandName: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: BrandColors.text,
  },
  subtitle: {
    fontSize: 15,
    color: BrandColors.textMuted,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
    fontSize: 16,
    color: BrandColors.text,
    backgroundColor: BrandColors.surfaceSoft,
  },
  error: { color: BrandColors.danger, fontSize: 14 },
  button: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  buttonPressed: { backgroundColor: BrandColors.primaryHover },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
});
