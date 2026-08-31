import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  /**
   * JWT `sub` is often decoded as a string (RFC 7519). Coerce to number for Prisma.
   */
  async validate(payload: { sub: number | string; phone?: string; role: string }) {
    const id = Number(payload.sub);
    if (!Number.isFinite(id) || id < 1) {
      throw new UnauthorizedException();
    }
    let user;
    try {
      user = await this.usersService.findOne(id);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new UnauthorizedException();
      }
      throw e;
    }

    if (user.isActive === false) {
      throw new UnauthorizedException();
    }

    const departmentIds = user.departmentIds ?? [];
    const productionDepartmentIds = await this.usersService.plantDepartmentIds(departmentIds);
    return {
      id,
      phone: user.phone,
      role: user.role,
      companyId: user.companyId,
      departmentId: user.departmentId,
      departmentIds,
      productionDepartmentIds,
    };
  }
}
