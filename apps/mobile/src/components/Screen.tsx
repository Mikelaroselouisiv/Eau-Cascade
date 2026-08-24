import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandColors } from '@/constants/brand';

export type ScreenEdges = Edge[] | 'tabs' | 'full' | 'modal';

type ScreenProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * - `tabs` : sous header + tab bar (défaut) — pas de top/bottom système
   * - `full` : écran plein (login, accueil sans header) — top + bottom
   * - `modal` : feuille / modal plein écran — top + bottom
   * - tableau custom d’edges
   */
  edges?: ScreenEdges;
  /** Remonte le contenu au-dessus du clavier (forms, panier, etc.). */
  keyboard?: boolean;
  /** Offset clavier (ex. hauteur header natif). */
  keyboardOffset?: number;
  backgroundColor?: string;
};

function resolveEdges(edges: ScreenEdges | undefined): Edge[] {
  if (Array.isArray(edges)) return edges;
  switch (edges) {
    case 'full':
    case 'modal':
      return ['top', 'right', 'bottom', 'left'];
    case 'tabs':
    default:
      return ['left', 'right'];
  }
}

/**
 * Conteneur d’écran standard :
 * safe areas (encoche / Dynamic Island / home indicator) +
 * option clavier professionnelle.
 */
export function Screen({
  children,
  style,
  edges = 'tabs',
  keyboard = false,
  keyboardOffset,
  backgroundColor = BrandColors.bg,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const resolved = resolveEdges(edges);
  const offset =
    keyboardOffset ??
    (Platform.OS === 'ios' ? Math.max(insets.top > 50 ? 8 : 0, 0) : 0);

  const body = (
    <SafeAreaView edges={resolved} style={[styles.flex, { backgroundColor }, style]}>
      {children}
    </SafeAreaView>
  );

  if (!keyboard) {
    return <View style={[styles.flex, { backgroundColor }]}>{body}</View>;
  }

  return (
    <View style={[styles.flex, { backgroundColor }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={offset}>
        {body}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
