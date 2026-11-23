import { Injectable } from '@nestjs/common';
import { cfg, full } from '../core/config.js';
import { ghJson, ghRaw, ownerRepos } from '../core/github.js';
import { ToolMeta, catalog } from './catalog.js';

export interface ToolRepo {
  name: string; description: string; url: string; branch: string;
  version: string | null;           // 플러그인 버전·최신 태그·없으면 null
  last: { sha: string; date: string; message: string; url: string } | null;
  changes: { sha: string; date: string; message: string; author: string; url: string }[];
  meta: ToolMeta | null;
}

const CACHE_MS = 5 * 60 * 1000;

@Injectable()
export class ToolsService {
  private cache: { at: number; repos: ToolRepo[] } | null = null;
  private readmes = new Map<string, { at: number; markdown: string }>();

  private async file(repo: string, path: string, ref: string): Promise<string | null> {
    const buf = await ghRaw(repo, path, ref, 2_000_000);
    return buf ? buf.toString('utf8') : null;
  }

  async list(force = false): Promise<ToolRepo[]> {
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.repos;
    const all = await ownerRepos();
    const cat = catalog(cfg.githubWeb, cfg.owner);
    // 도구 목록(catalog.ts)에 적힌 저장소만
    const mx = all.filter((r) => cat[r.name] && !r.archived).sort((a, b) => (cat[b.name]?.required ? 1 : 0) - (cat[a.name]?.required ? 1 : 0) || a.name.localeCompare(b.name));
    const repos = await Promise.all(mx.map((r) => this.one(r, cat[r.name] ?? null)));
    this.cache = { at: Date.now(), repos };
    return repos;
  }

  private async one(r: any, meta: ToolMeta | null): Promise<ToolRepo> {
    const branch = r.default_branch;
    const commits: any[] = (await ghJson<any[]>(`repos/${full(r.name)}/commits?sha=${encodeURIComponent(branch)}&per_page=8`)) || [];
    const changes = commits.map((c) => ({
      sha: c.sha.slice(0, 7), date: c.commit?.committer?.date ?? '', message: String(c.commit?.message || '').split('\n')[0],
      author: c.author?.login || c.commit?.author?.name || '', url: c.html_url,
    }));
    let version: string | null = null;
    try {
      if (meta?.versionFrom === 'marketplace') {
        const m = JSON.parse((await this.file(r.name, '.claude-plugin/marketplace.json', branch)) || '{}');
        version = (m.plugins || []).map((p: any) => `${p.name} ${p.version}`).join(', ') || null;
      } else {
        const tags: any[] = (await ghJson<any[]>(`repos/${full(r.name)}/tags?per_page=1`)) || [];
        version = tags[0]?.name ?? null;
      }
    } catch (e: any) { console.warn(`[도구] ${r.name} 버전 읽기 실패:`, e?.message); }
    return {
      name: r.name, description: r.description || '', url: r.html_url, branch, version,
      last: changes[0] ? { sha: changes[0].sha, date: changes[0].date, message: changes[0].message, url: changes[0].url } : null,
      changes, meta,
    };
  }

  /** README(없으면 SKILL.md) — 화면에서 펼쳐 본다 */
  async readme(name: string): Promise<string> {
    const hit = this.readmes.get(name);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.markdown;
    const repos = await this.list();
    const r = repos.find((x) => x.name === name);
    if (!r) throw new Error('도구 목록에 없는 저장소다');
    const md = (await this.file(name, 'README.md', r.branch)) ?? (await this.file(name, 'SKILL.md', r.branch)) ?? '';
    const markdown = md.length > 60000 ? md.slice(0, 60000) + '\n\n…(이하 생략, 저장소에서 보세요)' : md;
    this.readmes.set(name, { at: Date.now(), markdown });
    return markdown;
  }
}
