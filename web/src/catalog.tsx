import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, Catalog, CatalogComponent, CatalogNode } from './api';

// 화면 전체가 같은 카탈로그(이름·로고·소속)를 본다 — 설정에서 바꾸면 reload() 로 모두 갱신
interface Ctx { catalog: Catalog | null; reload: () => Promise<void>; comp: (key: string) => CatalogComponent | undefined; error: string;
  node: (id: string | null | undefined) => CatalogNode | undefined; rank: (id: string | null | undefined) => number }
const CatalogCtx = createContext<Ctx>({ catalog: null, reload: async () => {}, comp: () => undefined, error: '', node: () => undefined, rank: () => Infinity });

// 트리 순서(설정 화면에 보이는 위→아래)대로 노드를 펼친다
const flatten = (l: CatalogNode[], out: CatalogNode[] = []) => { for (const n of l) { out.push(n); flatten(n.children, out); } return out; };

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try { setCatalog(await api.catalog()); setError(''); } catch (e: any) { setError(String(e?.message || e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const comp = (key: string) => catalog?.components.find((c) => c.key === key);
  const nodes = flatten(catalog?.roots ?? []);
  const node = (id: string | null | undefined) => (id ? nodes.find((n) => n.id === id) : undefined);
  const rank = (id: string | null | undefined) => { const i = id ? nodes.findIndex((n) => n.id === id) : -1; return i < 0 ? Infinity : i; };
  return <CatalogCtx.Provider value={{ catalog, reload, comp, error, node, rank }}>{children}</CatalogCtx.Provider>;
}

export const useCatalog = () => useContext(CatalogCtx);
