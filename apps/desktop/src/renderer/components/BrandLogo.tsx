/**
 * Logo entreprise : `assets/icons/Logo Israel.png` (alias wide) + fallback icon.png
 */
import logoUrl from '@monorepo-assets/icons/logo-wide.png';

export function BrandLogo({
  size = 40,
  className = '',
  wide = false,
}: {
  size?: number;
  className?: string;
  /** Largeur dominante (login) — hauteur fixe, largeur auto */
  wide?: boolean;
}) {
  const style = wide
    ? { height: size, width: 'auto', maxWidth: size * 3.2, objectFit: 'contain' as const }
    : { width: size, height: size, objectFit: 'contain' as const };

  return (
    <img
      src={logoUrl}
      alt="Entreprise Israel"
      className={`brand-logo-img ${className}`.trim()}
      style={style}
    />
  );
}
