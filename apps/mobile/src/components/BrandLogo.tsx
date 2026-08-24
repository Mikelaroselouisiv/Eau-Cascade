import { Image, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

const logoSource = require('../../assets/images/logo-wide.png');

type BrandLogoProps = {
  /** Hauteur du logo (largeur auto, ratio wide). */
  height?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

/**
 * Logo Eau Cascade (wordmark wide) — signal de marque principal.
 */
export function BrandLogo({ height = 72, style, imageStyle }: BrandLogoProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Image
        source={logoSource}
        accessibilityLabel="Eau Cascade"
        resizeMode="contain"
        style={[{ height, width: height * 3.1 }, imageStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
