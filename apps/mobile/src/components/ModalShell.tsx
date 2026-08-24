import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandColors } from '@/constants/brand';

type ModalShellProps = {
  visible: boolean;
  onRequestClose: () => void;
  children: ReactNode;
  /** Contenu principal scrollable (liste, etc.). */
  body: ReactNode;
  /** Pied collé (inputs, total, actions) — reste au-dessus du clavier. */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
};

/**
 * Modal plein écran avec safe areas fiables.
 * React Native Modal sort de l’arbre : il faut un SafeAreaProvider dédié,
 * sinon le titre passe sous le Dynamic Island.
 */
export function ModalShell({
  visible,
  onRequestClose,
  children,
  body,
  footer,
  style,
  backgroundColor = BrandColors.bg,
}: ModalShellProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onRequestClose}
      statusBarTranslucent={Platform.OS === 'android'}>
      <SafeAreaProvider>
        <ModalShellInner
          backgroundColor={backgroundColor}
          style={style}
          header={children}
          body={body}
          footer={footer}
        />
      </SafeAreaProvider>
    </Modal>
  );
}

function ModalShellInner({
  header,
  body,
  footer,
  style,
  backgroundColor,
}: {
  header: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  backgroundColor: string;
}) {
  const insets = useSafeAreaInsets();

  // iOS : padding uniquement (pas de double adjust avec FlatList).
  // Android : resize logiciel (app.json) — éviter height qui provoque des oscillations.
  const kavBehavior = Platform.OS === 'ios' ? 'padding' : undefined;

  return (
    <View style={[styles.root, { backgroundColor, paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={kavBehavior}
        keyboardVerticalOffset={0}
        enabled={kavBehavior != null}>
        <View style={[styles.flex, style]}>
          {header}
          <View style={styles.flex}>{body}</View>
          {footer != null ? (
            <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.footerSafe}>
              {footer}
            </SafeAreaView>
          ) : (
            <View style={{ height: insets.bottom }} />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  footerSafe: { backgroundColor: 'transparent' },
});
