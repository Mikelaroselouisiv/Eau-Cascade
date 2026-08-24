import type { ReactNode } from 'react';
import { ImageBackground, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const waterTexture = require('../../assets/images/water-droplets-bg.png');

type WaterBackgroundProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Fond gouttes d’eau Eau Cascade, aligné sur Electron (`water-droplets-bg.png`). */
export function WaterBackground({ children, style }: WaterBackgroundProps) {
  return (
    <View style={[styles.fill, style]}>
      <ImageBackground
        source={waterTexture}
        resizeMode="cover"
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        imageStyle={styles.image}>
        <View style={styles.wash} pointerEvents="none" />
      </ImageBackground>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  image: { opacity: 0.55 },
  wash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(232, 244, 242, 0.72)',
  },
});
