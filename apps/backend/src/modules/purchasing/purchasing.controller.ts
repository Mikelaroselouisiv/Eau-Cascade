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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateGoodsReceiptDto, CreatePurchaseOrderDto, ReceivePurchaseOrderDto } from './dto/purchasing.dto';
import { PurchasingService } from './purchasing.service';

@Controller('purchasing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  @Post('orders')
  @Permissions('purchasing.manage')
  createOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.createPurchaseOrder(dto, user?.id);
  }

  @Get('orders')
  @Permissions('purchasing.manage')
  listOrders(@Query('companyId') companyId?: string) {
    const n = companyId ? Number(companyId) : undefined;
    return this.purchasingService.listPurchaseOrders(
      n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined,
    );
  }

  /** Totaux montants commandes (estimés) — admin uniquement, hors journal de caisse. */
  @Get('orders-summary')
  @Permissions('purchasing.manage')
  ordersSummary(@Query('companyId') companyId?: string) {
    const n = companyId ? Number(companyId) : NaN;
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException('companyId est requis.');
    }
    return this.purchasingService.getPurchaseOrdersAmountSummary(n);
  }

  @Get('orders/:id')
  @Permissions('purchasing.manage')
  getOrder(@Param('id', ParseIntPipe) id: number) {
    return this.purchasingService.getPurchaseOrder(id);
  }

  @Post('orders/:id/receive')
  @Permissions('purchasing.manage')
  receiveOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReceivePurchaseOrderDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.receivePurchaseOrder(id, dto, user?.id);
  }

  @Post('receipts')
  @Permissions('purchasing.manage')
  createReceipt(
    @Body() dto: CreateGoodsReceiptDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.createGoodsReceipt(dto, user?.id);
  }

  @Get('receipts')
  @Permissions('purchasing.manage')
  listReceipts(@Query('departmentId') departmentId?: string) {
    const n = departmentId ? Number(departmentId) : undefined;
    return this.purchasingService.listGoodsReceipts(
      n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined,
    );
  }

  @Get('receipts/:id')
  @Permissions('purchasing.manage')
  getReceipt(@Param('id', ParseIntPipe) id: number) {
    return this.purchasingService.getGoodsReceipt(id);
  }

  @Post('receipts/:id/post')
  @Permissions('purchasing.manage')
  postReceipt(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.postGoodsReceipt(id, user?.id);
  }

  @Delete('orders/:id')
  @Permissions('purchasing.manage')
  deleteOrder(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.deletePurchaseOrder(id, user?.id);
  }

  @Delete('receipts/:id')
  @Permissions('purchasing.manage')
  deleteReceipt(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.purchasingService.deleteGoodsReceipt(id, user?.id);
  }
}
