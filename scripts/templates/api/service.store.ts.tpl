import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'node:path';
import { audit } from '../core/audit.js';
import { cfg } from '../core/config.js';
import { JsonStore, RevConflict } from '../core/json-store.js';
import { __PASCAL__Item, invalid, toView } from './model.js';

interface Doc { rev: number; items: __PASCAL__Item[] }

// __TITLE__ — DATA_DIR/__NAME__.json 에 둔다. rev 로 동시 편집을 막는다(화면이 본 rev 와 다르면 409)
@Injectable()
export class __PASCAL__Service {
  private readonly store = new JsonStore<Doc>(join(cfg.dataDir, '__NAME__.json'), () => ({ rev: 0, items: [] }));

  list() {
    const d = this.store.get();
    return { ...toView(d.items), rev: d.rev, warning: this.store.broken };
  }

  async save(login: string, b: Partial<__PASCAL__Item> & { rev?: number }) {
    const why = invalid(b);
    if (why) throw new BadRequestException(why);
    const item: __PASCAL__Item = { id: b.id!, name: b.name!.trim(), note: b.note?.trim() || undefined, updatedAt: new Date().toISOString() };
    const d = this.write(b.rev, (draft) => { draft.items = [...draft.items.filter((x) => x.id !== item.id), item]; });
    await audit({ login, action: '__NAME__', target: item.id, detail: '저장', ok: true });
    return { ok: true, rev: d.rev };
  }

  async remove(login: string, id: string, rev?: number) {
    if (!this.store.get().items.some((x) => x.id === id)) throw new NotFoundException(`'${id}' 가 없습니다`);
    const d = this.write(rev, (draft) => { draft.items = draft.items.filter((x) => x.id !== id); });
    await audit({ login, action: '__NAME__', target: id, detail: '삭제', ok: true });
    return { ok: true, rev: d.rev };
  }

  private write(rev: number | undefined, fn: (draft: Doc) => void) {
    try { return this.store.update(rev, fn); }
    catch (e) { if (e instanceof RevConflict) throw new ConflictException(e.message); throw e; }
  }
}
