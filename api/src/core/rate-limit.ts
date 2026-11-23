// 시간 창 요청 제한 — 키(IP·아이디)마다 windowMs 동안 max 번. 메모리에 센다(콘솔은 한 대만 띄운다고 본다, 다시 시작하면 비워진다)
const SWEEP_AT = 5000;   // 키가 이만큼 쌓이면 지난 것을 한 번 비운다

export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(readonly max: number, readonly windowMs: number) {}

  private recent(key: string, now: number) {
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  private sweep(now: number) {
    if (this.hits.size <= SWEEP_AT) return;
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }

  /** 창 안에서 몇 번 */
  count(key: string, now = Date.now()) { return this.recent(key, now).length; }
  /** 한도에 닿았나(기록하지 않는다) — 로그인 실패 잠금처럼 '먼저 보고, 실패하면 센다' */
  full(key: string, now = Date.now()) { return this.count(key, now) >= this.max; }
  /** 한 번 센다 — 센 뒤의 횟수 */
  hit(key: string, now = Date.now()) {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
    this.sweep(now);
    return list.length;
  }
  /** 그 키의 기록을 지운다(예: 로그인에 성공하면 실패 횟수를 비운다) */
  delete(key: string) { return this.hits.delete(key); }
  /** 모두 비운다(시험) */
  clear() { this.hits.clear(); }
  /** 한도 안이면 세고 true, 넘었으면 세지 않고 false — 다운로드처럼 '되면 쓴다' */
  take(key: string, now = Date.now()) {
    if (this.full(key, now)) return false;
    this.hit(key, now);
    return true;
  }
}

/** IP 당 windowMs 에 n 번 — 함수 하나로(되면 true) */
export function rateLimiter(n: number, windowMs = 60_000) {
  const w = new SlidingWindow(n, windowMs);
  return (key: string, now = Date.now()) => w.take(key, now);
}
