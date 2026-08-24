import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_ANY_KEY = 'permissions_any';

/** Exige toutes les autorisations listées (ADMIN `*` satisfait tout). */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Exige au moins une des autorisations listées. */
export const PermissionsAny = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);
