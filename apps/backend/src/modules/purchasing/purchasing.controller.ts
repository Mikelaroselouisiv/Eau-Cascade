import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateGoodsReceiptDto, CreatePurchaseOrderDto, ReceivePurchaseOrderDto } from './dto/purchasing.dto';
import { PurchasingService } from './purchasing.service';

@Controller('purchasing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  @Post('orders')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  createOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.createPurchaseOrder(dto, user?.id);
  }

  @Get('orders')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  listOrders(@Query('companyId') companyId?: string) {
    const n = companyId ? Number(companyId) : undefined;
    return this.purchasingService.listPurchaseOrders(
      n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined,
    );
  }

  /** Totaux montants commandes (estimés) — admin uniquement, hors journal de caisse. */
  @Get('orders-summary')
  @Roles('ADMIN')
  ordersSummary(
    @Query('companyId') companyId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('departmentId') departmentId?: string,
    @Query('receptionStatus') receptionStatus?: string,
  ) {
    const n = companyId ? Number(companyId) : NaN;
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException('companyId est requis.');
    }
    const dept = departmentId ? Number(departmentId) : undefined;
    const reception =
      receptionStatus === 'pending' ||
      receptionStatus === 'partial' ||
      receptionStatus === 'complete'
        ? receptionStatus
        : undefined;
    return this.purchasingService.getPurchaseOrdersAmountSummary(n, {
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
      departmentId: dept != null && Number.isFinite(dept) && dept > 0 ? dept : undefined,
      receptionStatus: reception,
    });
  }

  @Get('orders/:id')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  getOrder(@Param('id', ParseIntPipe) id: number) {
    return this.purchasingService.getPurchaseOrder(id);
  }

  @Post('orders/:id/receive')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  receiveOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReceivePurchaseOrderDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.receivePurchaseOrder(id, dto, user?.id);
  }

  @Post('receipts')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  createReceipt(
    @Body() dto: CreateGoodsReceiptDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.createGoodsReceipt(dto, user?.id);
  }

  @Get('receipts')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  listReceipts(@Query('departmentId') departmentId?: string) {
    const n = departmentId ? Number(departmentId) : undefined;
    return this.purchasingService.listGoodsReceipts(
      n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined,
    );
  }

  @Get('receipts/:id')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  getReceipt(@Param('id', ParseIntPipe) id: number) {
    return this.purchasingService.getGoodsReceipt(id);
  }

  @Post('receipts/:id/post')
  @Roles('ADMIN', 'MANAGER', 'STOCK_MANAGER')
  postReceipt(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.postGoodsReceipt(id, user?.id);
  }

  @Delete('orders/:id')
  @Roles('ADMIN')
  deleteOrder(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.deletePurchaseOrder(id, user?.id);
  }

  @Delete('receipts/:id')
  @Roles('ADMIN')
  deleteReceipt(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.deleteGoodsReceipt(id, user?.id);
  }
}
