import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionsSatisfy } from '../permissions';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesService } from '../../modules/roles/roles.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolesService: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_ANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const hasPermMeta =
      (requiredAll && requiredAll.length > 0) || (requiredAny && requiredAny.length > 0);
    if (!hasPermMeta && (!requiredRoles || requiredRoles.length === 0)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string } | undefined;

    if (!user?.role) {
      throw new ForbiddenException('Accès refusé pour votre rôle');
    }

    if (hasPermMeta) {
      const userPerms = await this.rolesService.getPermissionsForUserRole(user.role);
      if (userPerms.includes('*')) return true;

      if (requiredAll && requiredAll.length > 0) {
        if (!permissionsSatisfy(userPerms, requiredAll)) {
          throw new ForbiddenException('Accès refusé pour votre rôle');
        }
      }
      if (requiredAny && requiredAny.length > 0) {
        if (!requiredAny.some((p) => userPerms.includes(p))) {
          throw new ForbiddenException('Accès refusé pour votre rôle');
        }
      }
      return true;
    }

    const allowed = await this.rolesService.userCanAccessRoleGate(user.role, requiredRoles!);
    if (!allowed) {
      throw new ForbiddenException('Accès refusé pour votre rôle');
    }

    return true;
  }
}
