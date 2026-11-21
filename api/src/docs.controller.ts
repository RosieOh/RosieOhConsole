import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import { AuthGuard } from './auth/auth.guard.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = fileURLToPath(new URL('../docs', import.meta.url));

interface DocEntry { id: string; service: string; title: string; file: string; }

function manifest(): DocEntry[] {
  try { return JSON.parse(readFileSync(join(DOCS_DIR, 'manifest.json'), 'utf8')); }
  catch { return []; }
}

@UseGuards(AuthGuard)
@Controller('dashapi/docs')
export class DocsController {
  @Get()
  list() {
    return { docs: manifest().map(({ id, service, title }) => ({ id, service, title })) };
  }

  @Get(':id')
  one(@Param('id') id: string) {
    const entry = manifest().find((d) => d.id === id);
    if (!entry) throw new NotFoundException('unknown doc');
    const path = join(DOCS_DIR, entry.file);
    if (!path.startsWith(DOCS_DIR) || !existsSync(path)) throw new NotFoundException('file missing');
    return { id: entry.id, title: entry.title, service: entry.service, markdown: readFileSync(path, 'utf8') };
  }
}
