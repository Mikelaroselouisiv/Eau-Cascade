import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  CreateProductionWorkerDto,
  DeclareWorkerMovementDto,
  UpdateProductionWorkerDto,
} from './dto/production-worker.dto';
import { ProductionWorkersService } from './production-workers.service';

type ScopeUser = {
  id: number;
  role?: string | null;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Controller('production-workers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions('production.use')
export class ProductionWorkersController {
  constructor(private readonly workers: ProductionWorkersService) {}

  @Get()
  list(
    @GetUser() user: ScopeUser,
    @Query('departmentId') departmentRaw?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const departmentId = departmentRaw ? Number.parseInt(departmentRaw, 10) : NaN;
    if (!Number.isFinite(departmentId) || departmentId <= 0) {
      throw new BadRequestException('departmentId est requis.');
    }
    return this.workers.listWorkers(departmentId, user, {
      includeInactive: includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Get('issues')
  listIssues(
    @GetUser() user: ScopeUser,
    @Query('departmentId') departmentRaw?: string,
    @Query('workerId') workerRaw?: string,
  ) {
    const departmentId = departmentRaw ? Number.parseInt(departmentRaw, 10) : NaN;
    if (!Number.isFinite(departmentId) || departmentId <= 0) {
      throw new BadRequestException('departmentId est requis.');
    }
    const workerId = workerRaw ? Number.parseInt(workerRaw, 10) : undefined;
    return this.workers.listIssues(
      departmentId,
      user,
      Number.isFinite(workerId) && workerId! > 0 ? workerId : undefined,
    );
  }

  @Post('issues')
  declareIssue(@Body() dto: DeclareWorkerMovementDto, @GetUser() user: ScopeUser) {
    return this.workers.declareIssue(dto, user);
  }

  @Get('outputs')
  listOutputs(
    @GetUser() user: ScopeUser,
    @Query('departmentId') departmentRaw?: string,
    @Query('workerId') workerRaw?: string,
  ) {
    const departmentId = departmentRaw ? Number.parseInt(departmentRaw, 10) : NaN;
    if (!Number.isFinite(departmentId) || departmentId <= 0) {
      throw new BadRequestException('departmentId est requis.');
    }
    const workerId = workerRaw ? Number.parseInt(workerRaw, 10) : undefined;
    return this.workers.listOutputs(
      departmentId,
      user,
      Number.isFinite(workerId) && workerId! > 0 ? workerId : undefined,
    );
  }

  @Post('outputs')
  declareOutput(@Body() dto: DeclareWorkerMovementDto, @GetUser() user: ScopeUser) {
    return this.workers.declareOutput(dto, user);
  }

  @Get(':id')
  getOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user: ScopeUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.workers.getWorker(id, user, { dateFrom, dateTo });
  }

  @Post()
  @Permissions('workers.manage')
  create(@Body() dto: CreateProductionWorkerDto, @GetUser() user: ScopeUser) {
    return this.workers.createWorker(dto, user);
  }

  @Patch(':id')
  @Permissions('workers.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductionWorkerDto,
    @GetUser() user: ScopeUser,
  ) {
    return this.workers.updateWorker(id, dto, user);
  }
}
