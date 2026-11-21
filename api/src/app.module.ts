import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessController, UsersController } from './access/access.controller.js';
import { AccountController, AccountsAdminController } from './accounts/accounts.controller.js';
import { ApksController } from './apks/apks.controller.js';
import { ApksService } from './apks/apks.service.js';
import { AppController } from './app.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { BoardService } from './board/board.service.js';
import { BuildNotifyController } from './build-notify/build-notify.controller.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { CatalogService } from './catalog/catalog.service.js';
import { PublicController } from './catalog/public.controller.js';
import { RunnersController } from './runners/runners.controller.js';
import { RunnersService } from './runners/runners.service.js';
import { FlagsController } from './flags/flags.controller.js';
import { FlagsService } from './flags/flags.service.js';
import { DeployController } from './deploy/deploy.controller.js';
import { DeployService } from './deploy/deploy.service.js';
import { StoreAppsService } from './deploy/store-apps.service.js';
import { DocsController } from './docs.controller.js';
import { SecretsController } from './secrets/secrets.controller.js';
import { SecretsService } from './secrets/secrets.service.js';
import { FlowController } from './flow/flow.controller.js';
import { FlowService } from './flow/flow.service.js';
import { PromoteController } from './promote/promote.controller.js';
import { PromoteService } from './promote/promote.service.js';
import { RelationsController } from './relations/relations.controller.js';
import { RelationsService } from './relations/relations.service.js';
import { ProbeIngestController, ServersController } from './servers/servers.controller.js';
import { ServersService } from './servers/servers.service.js';
import { StatusService } from './status.service.js';
import { ToolsController } from './tools/tools.controller.js';
import { ToolsService } from './tools/tools.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AppController, AuthController, AccountController, AccountsAdminController, DocsController, ToolsController, ApksController, DeployController, CatalogController, PublicController, AccessController, UsersController, RunnersController, SecretsController, RelationsController, FlowController, PromoteController, ServersController, ProbeIngestController, FlagsController, BuildNotifyController],
  providers: [StatusService, ToolsService, ApksService, DeployService, StoreAppsService, BoardService, CatalogService, RunnersService, SecretsService, AuthGuard, RelationsService, FlowService, PromoteService, ServersService, FlagsService],
})
export class AppModule {}
