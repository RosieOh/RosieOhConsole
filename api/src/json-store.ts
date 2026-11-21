import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// /data 의 JSON 파일 하나 — 시작할 때 동기로 읽고, 쓸 때는 임시 파일 → rename.
// rev(판 번호)로 동시 편집을 막는다: 화면이 본 rev 와 지금 rev 가 다르면 저장하지 않는다.
// 파일이 깨졌으면 .broken-<시각> 으로 옮겨 두고 빈 값으로 시작한다(broken 에 남겨 화면에 경고).
export interface Versioned { rev: number }

export class RevConflict extends Error {
  constructor() { super('다른 사람이 먼저 바꿨습니다, 새로고침한 뒤 다시 하세요'); }
}

export class JsonStore<T extends Versioned> {
  private value: T;
  broken: string | null = null;

  constructor(readonly path: string, private readonly empty: () => T) {
    this.value = empty();
    if (!existsSync(path)) return;
    try {
      const v = JSON.parse(readFileSync(path, 'utf8'));
      if (!v || typeof v !== 'object' || typeof v.rev !== 'number') throw new Error('형식이 아니다');
      this.value = { ...empty(), ...v };
    } catch (e: any) {
      const to = `${path}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { renameSync(path, to); } catch { /* 옮기지 못해도 빈 값으로 뜬다 */ }
      this.broken = `${path} 를 읽지 못해(${e?.message}) 기본값으로 시작했습니다, 원본은 ${to}`;
      console.warn('[저장] ' + this.broken);
    }
  }

  get(): T { return this.value; }

  /** rev 가 맞을 때만 바꾼다. fn 은 복사본을 고친다 */
  update(rev: number | undefined, fn: (draft: T) => void): T {
    if (rev !== undefined && rev !== this.value.rev) throw new RevConflict();
    const draft: T = structuredClone(this.value);
    fn(draft);
    draft.rev = this.value.rev + 1;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path + '.tmp', JSON.stringify(draft, null, 2), 'utf8');
    renameSync(this.path + '.tmp', this.path);
    this.value = draft;
    return draft;
  }
}
