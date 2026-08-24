/**
 * ESC/POS attend un jeu 8 bits (PC850), pas de l'UTF-8.
 * Les accents français en UTF-8 sont donc perdus sur l'imprimante.
 */

const ESC = 0x1b;

/** ESC t 2 = table PC850 (multilingue, largement supportée par les thermiques ESC/POS). */
export const ESC_SELECT_PC850 = [ESC, 0x74, 0x02];

const CP850: Record<string, number> = {
  '\u00c7': 0x80,
  '\u00fc': 0x81,
  '\u00e9': 0x82,
  '\u00e2': 0x83,
  '\u00e4': 0x84,
  '\u00e0': 0x85,
  '\u00e5': 0x86,
  '\u00e7': 0x87,
  '\u00ea': 0x88,
  '\u00eb': 0x89,
  '\u00e8': 0x8a,
  '\u00ef': 0x8b,
  '\u00ee': 0x8c,
  '\u00ec': 0x8d,
  '\u00c4': 0x8e,
  '\u00c5': 0x8f,
  '\u00c9': 0x90,
  '\u00e6': 0x91,
  '\u00c6': 0x92,
  '\u00f4': 0x93,
  '\u00f6': 0x94,
  '\u00f2': 0x95,
  '\u00fb': 0x96,
  '\u00f9': 0x97,
  '\u00ff': 0x98,
  '\u00d6': 0x99,
  '\u00dc': 0x9a,
  '\u00f8': 0x9b,
  '\u00a3': 0x9c,
  '\u00d8': 0x9d,
  '\u00d7': 0x9e,
  '\u0192': 0x9f,
  '\u00e1': 0xa0,
  '\u00ed': 0xa1,
  '\u00f3': 0xa2,
  '\u00fa': 0xa3,
  '\u00f1': 0xa4,
  '\u00d1': 0xa5,
  '\u00aa': 0xa6,
  '\u00ba': 0xa7,
  '\u00bf': 0xa8,
  '\u00ae': 0xa9,
  '\u00bd': 0xab,
  '\u00bc': 0xac,
  '\u00a1': 0xad,
  '\u00c1': 0xb5,
  '\u00c2': 0xb6,
  '\u00c0': 0xb7,
  '\u00a9': 0xb8,
  '\u00a2': 0xbd,
  '\u00a5': 0xbe,
  '\u00e3': 0xc6,
  '\u00c3': 0xc7,
  '\u00a4': 0xcf,
  '\u00f0': 0xd0,
  '\u00d0': 0xd1,
  '\u00ca': 0xd2,
  '\u00cb': 0xd3,
  '\u00c8': 0xd4,
  '\u00cd': 0xd6,
  '\u00ce': 0xd7,
  '\u00cf': 0xd8,
  '\u00cc': 0xde,
  '\u00d3': 0xe0,
  '\u00df': 0xe1,
  '\u00d4': 0xe2,
  '\u00d2': 0xe3,
  '\u00f5': 0xe4,
  '\u00d5': 0xe5,
  '\u00b5': 0xe6,
  '\u00fe': 0xe7,
  '\u00de': 0xe8,
  '\u00da': 0xe9,
  '\u00db': 0xea,
  '\u00d9': 0xeb,
  '\u00fd': 0xec,
  '\u00dd': 0xed,
  '\u00af': 0xee,
  '\u00b4': 0xef,
  '\u00b1': 0xf1,
  '\u00be': 0xf3,
  '\u00a7': 0xf5,
  '\u00f7': 0xf6,
  '\u00b0': 0xf8,
  '\u00a8': 0xf9,
  '\u00b7': 0xfa,
  '\u00b9': 0xfb,
  '\u00b3': 0xfc,
  '\u00b2': 0xfd,
};

const FOLD: Record<string, string> = {
  '\u0153': 'oe',
  '\u0152': 'OE',
  '\u00e6': 'ae',
  '\u00c6': 'AE',
  '\u00df': 'ss',
  '\u2014': '-',
  '\u2013': '-',
  '\u2212': '-',
  '\u2026': '...',
  '\u2018': "'",
  '\u2019': "'",
  '\u02bb': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u00ab': '"',
  '\u00bb': '"',
  '\u20ac': 'EUR',
  '\u00d7': 'x',
  '\u2022': '-',
  '\u00b7': '.',
};

const SPACE_CODES = new Set([
  0x00a0, 0x202f, 0x2007, 0x2008, 0x2009, 0x200a, 0x200b, 0xfeff, 0x2060,
]);

/** Encode un texte ticket en octets PC850 (ASCII + accents FR). */
export function encodeEscPosText(text: string): number[] {
  const src = text.normalize('NFC');
  const out: number[] = [];
  for (const ch of src) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d) {
      out.push(code);
      continue;
    }
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    if (SPACE_CODES.has(code)) {
      out.push(0x20);
      continue;
    }
    const mapped = CP850[ch];
    if (mapped != null) {
      out.push(mapped);
      continue;
    }
    const folded = FOLD[ch];
    if (folded) {
      out.push(...encodeEscPosText(folded));
      continue;
    }
    out.push(0x3f);
  }
  return out;
}
