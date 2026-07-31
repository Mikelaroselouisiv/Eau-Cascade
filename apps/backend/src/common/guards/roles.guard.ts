import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionsSatisfy } from '../permissions';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesService } from '../../modules/roles/roles.service';

/**
 * Autorisation :
 * 1. Si `@Permissions(...)` → contrôle les droits AppRole (config admin). ADMIN `*` OK.
 * 2. Sinon si `@Roles(...)` → porte par code de rôle (+ rôles custom supersets).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolesService: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (
      (!requiredPermissions || requiredPermissions.length === 0) &&
      (!requiredRoles || requiredRoles.length === 0)
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string } | undefined;

    if (!user?.role) {
      throw new ForbiddenException('Accès refusé pour votre rôle');
    }

    // Permissions configurables : source de vérité quand déclarées.
    if (requiredPermissions && requiredPermissions.length > 0) {
      const userPerms = await this.rolesService.getPermissionsForUserRole(user.role);
      if (!permissionsSatisfy(userPerms, requiredPermissions)) {
        throw new ForbiddenException('Accès refusé : autorisation manquante');
      }
      return true;
    }

    const allowed = await this.rolesService.userCanAccessRoleGate(user.role, requiredRoles ?? []);
    if (!allowed) {
      throw new ForbiddenException('Accès refusé pour votre rôle');
    }

    return true;
  }
}
