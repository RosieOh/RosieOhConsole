import type { NextFunction, Request, Response } from 'express';
import { cfg } from './config.js';
import { sessionOf } from './auth/session.js';

// /mxtest/<경로> → 테스트배드 TESTBED_URL/<경로>
// 브라우저가 테스트배드를 같은 출처로 부를 수 없으니 API 문서·테스터가 이 길로 부른다. TESTBED_URL 이 비면 꺼진다.
// 로그인한 사람만. 콘솔 쿠키는 넘기지 않고, 테스트배드로만 간다(운영 주소로는 못 간다).
const PASS_REQ = ['authorization', 'content-type', 'accept', 'accept-language'];
const PASS_RES = ['content-type', 'cache-control', 'location', 'www-authenticate'];

export async function testbedProxy(req: Request, res: Response, next: NextFunction) {
  if (!sessionOf(req)) return res.status(401).json({ message: '로그인이 필요합니다' });
  if (!cfg.testbedUrl) return res.status(503).json({ message: '테스트배드 주소(TESTBED_URL)가 설정되지 않았습니다' });
  try {
    const headers: Record<string, string> = {};
    for (const h of PASS_REQ) { const v = req.headers[h]; if (typeof v === 'string') headers[h] = v; }
    const chunks: Buffer[] = [];
    if (!['GET', 'HEAD'].includes(req.method)) for await (const c of req) chunks.push(c as Buffer);
    const r = await fetch(cfg.testbedUrl + req.url, {
      method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
      redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    res.status(r.status);
    for (const h of PASS_RES) { const v = r.headers.get(h); if (v) res.setHeader(h, v); }
    res.setHeader('X-Proxied-To', 'testbed');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    next(e);
  }
}
