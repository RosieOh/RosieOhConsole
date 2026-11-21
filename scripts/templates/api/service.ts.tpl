import { Injectable } from '@nestjs/common';
import { __PASCAL__Item, __PASCAL__View, toView } from './model.js';

const TTL_MS = 30 * 1000;

// __TITLE__ — 원본에서 읽어 잠깐 들고 있는다. GitHub 은 ../github.js 의 ghJson·ghPaged·ownerRepos 를 쓴다
@Injectable()
export class __PASCAL__Service {
  private cache: { at: number; data: __PASCAL__View } | null = null;

  async list(force = false): Promise<__PASCAL__View> {
    if (!force && this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.data;
    const data = toView(await this.load());
    this.cache = { at: Date.now(), data };
    return data;
  }

  // TODO: 실제 원본(GitHub API 등)으로 바꾼다
  private async load(): Promise<__PASCAL__Item[]> {
    return [{ id: 'sample', name: '예시 항목', note: 'api/src/__NAME__/__NAME__.service.ts 의 load() 를 채운다' }];
  }
}
