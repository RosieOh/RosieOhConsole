import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { LOGO_FILE_RE, LOGO_TYPES, LogoExt } from './logos.js';
import { CatalogService } from './catalog.service.js';

// 로그인 없이 — APK 화면(/apk)이 쓰는 카탈로그 일부와 로고 그림
@Controller('dashapi/pub')
export class PublicController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog')
  catalogView() { return this.catalog.publicView(); }

  @Get('logos/:file')
  logo(@Param('file') file: string, @Res() res: Response) {
    if (!LOGO_FILE_RE.test(file) || !existsSync(`${this.catalog.logoDir}/${file}`)) throw new NotFoundException();
    const ext = file.split('.').pop() as LogoExt;
    res.setHeader('Content-Type', LOGO_TYPES[ext]);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // 이름이 내용 해시라 바뀌지 않는다
    res.sendFile(file, { root: this.catalog.logoDir });
  }
}
