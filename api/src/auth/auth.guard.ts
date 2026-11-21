import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { sessionOf } from './session.js';

export const ADMIN_ONLY = 'adminOnly';
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);
export const DEPLOYER_ONLY = 'deployerOnly';
/** 관리자 또는 배포 담당 */
export const DeployerOnly = () => SetMetadata(DEPLOYER_ONLY, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const s = sessionOf(req);
    if (!s) throw new UnauthorizedException('로그인이 필요합니다');
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [ctx.getHandler(), ctx.getClass()]);
    if (adminOnly && !s.admin) throw new ForbiddenException('관리자만 쓸 수 있습니다');
    const deployerOnly = this.reflector.getAllAndOverride<boolean>(DEPLOYER_ONLY, [ctx.getHandler(), ctx.getClass()]);
    if (deployerOnly && !s.deployer) throw new ForbiddenException('관리자, 배포 담당만 쓸 수 있습니다');
    (req as any).session = s;
    return true;
  }
}
