import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/** Exige toutes ces autorisations (ADMIN `*` passe). Prioritaire sur `@Roles` si présent. */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
