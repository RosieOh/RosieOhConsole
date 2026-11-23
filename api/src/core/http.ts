import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { originOk } from './config.js';

export const CROSS_ORIGIN = '다른 출처에서 온 요청입니다';

/**
 * 쓰기 요청의 출처 검사 — 다른 사이트가 사용자 쿠키로 몰래 보내는 요청(CSRF) 막기.
 * Origin 이 PUBLIC_URL·ALLOWED_ORIGINS 가 아니면 403. 요청이나 Origin 값을 그대로 받는다
 */
export function assertSameOrigin(reqOrOrigin: Request | string | undefined) {
  const origin = typeof reqOrOrigin === 'string' || reqOrOrigin === undefined ? reqOrOrigin : reqOrOrigin.get('origin');
  if (!originOk(origin)) throw new ForbiddenException(CROSS_ORIGIN);
}
