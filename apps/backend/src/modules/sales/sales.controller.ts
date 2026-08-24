import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CollectSaleBalanceDto } from './dto/cash-gap.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @Permissions('sales.create')
  create(
    @Body() createSaleDto: CreateSaleDto,
    @GetUser() user?: { id?: number; role?: string },
  ) {
    return this.salesService.create(createSaleDto, user?.id, user?.role);
  }

  @Get('cash-gaps')
  @Permissions('pos.use')
  listCashGaps(
    @Query('companyId') companyIdRaw?: string,
    @Query('departmentId') departmentIdRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : NaN;
    if (!Number.isFinite(companyId) || companyId <= 0) {
      throw new BadRequestException('companyId requis');
    }
    const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
    const takeN = takeRaw ? Number.parseInt(takeRaw, 10) : undefined;
    return this.salesService.listCashGaps({
      companyId,
      departmentId:
        Number.isFinite(departmentIdN) && departmentIdN > 0 ? departmentIdN : undefined,
      take: takeN,
    });
  }

  @Post(':id/settle-change')
  @Permissions('sales.create')
  settleChange(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.salesService.settleChange(id, user?.id);
  }

  @Post(':id/collect-balance')
  @Permissions('sales.create')
  collectBalance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CollectSaleBalanceDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.salesService.collectBalance(id, dto.amount, user?.id);
  }

  @Get()
  @Permissions('sales.view')
  findAll(
    @Query('companyId') companyIdRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('departmentId') departmentIdRaw?: string,
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    if (companyId !== undefined && Number.isFinite(companyId) && companyId > 0) {
      const skip = skipRaw ? Number.parseInt(skipRaw, 10) : 0;
      const take = takeRaw ? Number.parseInt(takeRaw, 10) : 10;
      const createdAtGte =
        createdFrom != null && createdFrom.trim() !== ''
          ? new Date(createdFrom.trim())
          : undefined;
      const createdAtLte =
        createdTo != null && createdTo.trim() !== '' ? new Date(createdTo.trim()) : undefined;
      const gteOk = createdAtGte != null && Number.isFinite(createdAtGte.getTime());
      const lteOk = createdAtLte != null && Number.isFinite(createdAtLte.getTime());
      const departmentIdN = departmentIdRaw ? Number.parseInt(departmentIdRaw, 10) : NaN;
      const departmentId =
        Number.isFinite(departmentIdN) && (departmentIdN as number) > 0 ? (departmentIdN as number) : undefined;
      return this.salesService.findManyPaginated({
        companyId,
        skip,
        take,
        createdAtGte: gteOk ? createdAtGte : undefined,
        createdAtLte: lteOk ? createdAtLte : undefined,
        departmentId,
      });
    }
    return this.salesService.findAll();
  }

  @Get(':id/export/pdf')
  @PermissionsAny('sales.view', 'deliveries.view')
  async exportSalePdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const buffer = await this.salesService.buildSalePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ticket-vente-${id}.pdf"`);
    res.send(buffer);
  }

  @Get(':id')
  @PermissionsAny('sales.view', 'deliveries.view')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.salesService.findOne(id);
  }

  @Patch(':id/cancel')
  @Permissions('sales.cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @GetUser() user?: { id?: number }) {
    return this.salesService.cancelSale(id, user?.id);
  }

  @Patch(':id/refund')
  @Permissions('sales.cancel')
  refund(@Param('id', ParseIntPipe) id: number, @GetUser() user?: { id?: number }) {
    return this.salesService.refundSale(id, user?.id);
  }

  /** Suppression définitive : réservé à qui a sales.delete (ADMIN `*` par défaut). */
  @Delete(':id')
  @Permissions('sales.delete')
  deletePermanently(
    @Param('id', ParseIntPipe) id: number,
    @Query('companyId') companyIdRaw: string | undefined,
    @GetUser() user?: { id?: number },
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    const cid =
      companyId != null && Number.isFinite(companyId) && companyId > 0 ? companyId : undefined;
    return this.salesService.deleteSalePermanently(id, user?.id, cid);
  }
}
