import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// 모든 응답에 붙이는 보안 헤더 — 클릭재킹(iframe 에 넣고 배포 버튼 누르게 하기)·XSS·MIME 추측·정보 새기를 막는다.
// CSP 의 인라인 스크립트는 빌드된 index.html 안의 것만 해시로 허용한다(테마 깜빡임 막는 한 줄). 화면을 바꿔도 시작할 때 다시 센다.
// 응답이 자기 CSP 를 따로 정하면(공개 카탈로그 카드처럼) 그쪽이 덮어쓴다.

/** index.html 안의 src 없는 <script> 들 → CSP 해시('sha256-…') */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (m[1].trim()) out.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return out;
}

export function contentSecurityPolicy(scriptHashes: string[] = []) {
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHashes.length ? ' ' + scriptHashes.join(' ') : ''}`,
    "style-src 'self' 'unsafe-inline'",           // React style 속성·index.html 의 첫 화면 <style>
    "img-src 'self' data: blob: https:",          // GitHub 아바타·서비스 로고
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(opts: { https: boolean; indexHtml?: string }) {
  const csp = contentSecurityPolicy(opts.indexHtml ? inlineScriptHashes(opts.indexHtml) : []);
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (opts.https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
