import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { BrandColors } from '@/constants/brand';
import { formatMoneyAmount } from '@/utils/datetime';

type Props = {
  value: number | string | null | undefined;
  style?: StyleProp<TextStyle>;
  amountStyle?: StyleProp<TextStyle>;
  currencyStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Montant + « HTG » en petit caractère. */
export function MoneyText({ value, style, amountStyle, currencyStyle, numberOfLines }: Props) {
  const amount = formatMoneyAmount(value);
  if (amount === '—') {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        —
      </Text>
    );
  }

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      <Text style={amountStyle}>{amount}</Text>
      <Text style={[styles.currency, currencyStyle]}> HTG</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  currency: {
    fontSize: 11,
    fontWeight: '600',
    color: BrandColors.textMuted,
  },
});
