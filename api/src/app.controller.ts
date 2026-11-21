import { cfg } from './config.js';
import { persistInfo } from './persist.js';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth/auth.guard.js';
import { StatusService } from './status.service.js';

@Controller('dashapi')
export class AppController {
  constructor(private readonly jwt: JwtService, private readonly status: StatusService) {}

  // 프록시·배포 헬스 확인용 — 로그인 없이
  @Get('health')
  health() { const p = persistInfo(); return { ok: true, storage: p.driver, ...(p.error ? { storageError: p.error } : {}) }; }

  @UseGuards(AuthGuard)
  @Get('status')
  getStatus() {
    return { services: this.status.getAll() };
  }

  @UseGuards(AuthGuard)
  @Get('info')
  getInfo() {
    return { services: this.status.registryInfo() };
  }

  // 테스트배드 API 호출용 JWT (공유 시크릿)
  @UseGuards(AuthGuard)
  @Post('token')
  makeToken(@Body() body: { sub?: string; role?: string; ttl?: number }) {
    const secret = process.env.JWT_SECRET_KEY;
    if (!secret) return { error: 'JWT_SECRET_KEY 가 설정되지 않았다' };
    const ttl = Math.min(Math.max(body?.ttl ?? 3600, 60), 60 * 60 * 24 * 30);
    const payload: Record<string, string> = { sub: body?.sub || 'dev-tester' };
    if (body?.role) payload.role = body.role;
    const issuer = process.env.JWT_ISSUER || cfg.publicUrl;
    const token = this.jwt.sign(payload, { secret, issuer, expiresIn: ttl, algorithm: 'HS256' });
    return { token, expires_in: ttl, issuer };
  }
}
