export function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'CASH':
      return 'Espèces';
    case 'CARD':
      return 'Carte';
    case 'MOBILE_MONEY':
      return 'Mobile money';
    case 'SPLIT':
      return 'Mixte';
    case 'CREDIT':
      return 'Crédit';
    case 'BANK':
      return 'Banque';
    default:
      return method;
  }
}
