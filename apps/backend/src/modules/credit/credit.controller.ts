import {
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
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreditService } from './credit.service';
import {
  CreateCreditCustomerDto,
  CreateCreditSaleDto,
  RecordCreditPaymentDto,
  UpdateCreditCustomerDto,
} from './dto/credit.dto';

@Controller('credit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @Get('summary')
  summary(@Query('companyId', ParseIntPipe) companyId: number) {
    return this.creditService.summary(companyId);
  }

  @Get('customers')
  listCustomers(
    @Query('companyId', ParseIntPipe) companyId: number,
    @Query('q') q?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.creditService.listCustomers(companyId, {
      q,
      includeInactive: includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Get('customers/:id')
  getCustomer(@Param('id', ParseIntPipe) id: number) {
    return this.creditService.getCustomer(id);
  }

  @Post('customers')
  createCustomer(
    @Body() dto: CreateCreditCustomerDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.creditService.createCustomer(dto, user?.id);
  }

  @Patch('customers/:id')
  updateCustomer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCreditCustomerDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.creditService.updateCustomer(id, dto, user?.id);
  }

  @Post('sales')
  createSale(@Body() dto: CreateCreditSaleDto, @GetUser() user?: { id?: number }) {
    return this.creditService.createCreditSale(dto, user?.id);
  }

  @Post('payments')
  recordPayment(
    @Body() dto: RecordCreditPaymentDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.creditService.recordPayment(dto, user?.id);
  }
}
