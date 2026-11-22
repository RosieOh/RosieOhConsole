import { Controller, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { FlowService } from './flow.service.js';

@UseGuards(AuthGuard)
@Controller('dashapi/flow')
export class FlowController {
  constructor(private readonly flow: FlowService) {}

  @Get()
  graph() { return this.flow.graph(); }

  // 실행 중·막 끝난 배포 — 화면이 2~3초마다 부른다(서버는 저장소별로 3초/15초 간격으로 GitHub 을 본다)
  @Get('live')
  live() { return this.flow.live(); }

  // 서비스별 파이프라인(커밋 → 빌드 → 배포) — 화면이 몇 초마다 부른다. GitHub 은 60초(도는 배포가 있으면 5초)에 한 번
  @Get('pipelines')
  pipelines(@Query('refresh') refresh?: string) { return this.flow.pipelines(refresh === '1'); }

  @Get('tail')
  tail(@Query('repo') repo: string, @Query('run', ParseIntPipe) run: number) {
    return this.flow.tail(String(repo || ''), run);
  }

  @Get('step-log')
  stepLog(@Query('repo') repo: string, @Query('run', ParseIntPipe) run: number, @Query('step') step?: string) {
    return this.flow.stepLog(String(repo || ''), run, step || undefined);
  }
}
