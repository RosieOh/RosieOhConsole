import { existsSync, renameSync } from 'node:fs';
import { basename } from 'node:path';
import { readDoc, writeDoc } from './persist.js';

// 문서 하나(카탈로그·권한·예약 …) — MariaDB store 표의 한 줄, DB 가 없으면 DATA_DIR 의 JSON 파일(persist.ts).
// 시작할 때 읽어 메모리에 두고, rev(판 번호)로 동시 편집을 막는다: 화면이 본 rev 와 지금 rev 가 다르면 저장하지 않는다.
// 읽지 못하면(깨진 파일) .broken-<시각> 으로 옮겨 두고 빈 값으로 시작한다(broken 에 남겨 화면에 경고).
export interface Versioned { rev: number }

export class RevConflict extends Error {
  constructor() { super('다른 사람이 먼저 바꿨습니다, 새로고침한 뒤 다시 하세요'); }
}

export class JsonStore<T extends Versioned> {
  private value: T;
  broken: string | null = null;
  /** 저장 이름 — 경로의 파일 이름(…/catalog.json → catalog) */
  readonly name: string;

  constructor(readonly path: string, private readonly empty: () => T) {
    this.name = basename(path).replace(/\.json$/, '');
    this.value = empty();
    try {
      const v = readDoc<T>(this.name, path);
      if (v === null) return;
      if (!v || typeof v !== 'object' || typeof (v as any).rev !== 'number') throw new Error('형식이 아니다');
      this.value = { ...empty(), ...v };
    } catch (e: any) {
      const to = `${path}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { if (existsSync(path)) renameSync(path, to); } catch { /* 옮기지 못해도 빈 값으로 뜬다 */ }
      this.broken = `${this.name} 를 읽지 못해(${e?.message}) 기본값으로 시작했습니다${existsSync(to) ? `, 원본은 ${to}` : ''}`;
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
    writeDoc(this.name, draft, draft.rev, this.path);
    this.value = draft;
    return draft;
  }
}
