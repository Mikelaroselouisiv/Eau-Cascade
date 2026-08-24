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
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BanksService } from './banks.service';
import {
  CreateBankAccountDto,
  CreateBankDto,
  CreateBankTransactionDto,
  UpdateBankAccountDto,
  UpdateBankDto,
} from './dto/banks.dto';

@Controller('banks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @Get('summary')
  @Permissions('banks.view')
  summary(@Query('companyId', ParseIntPipe) companyId: number) {
    return this.banksService.summary(companyId);
  }

  /** Liste pour config banques + sélection compte au POS (paiement banque). */
  @Get()
  @PermissionsAny('banks.view', 'pos.use', 'sales.create')
  listBanks(
    @Query('companyId', ParseIntPipe) companyId: number,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.banksService.listBanks(
      companyId,
      includeInactive === '1' || includeInactive === 'true',
    );
  }

  @Post()
  @Permissions('banks.manage')
  createBank(@Body() dto: CreateBankDto, @GetUser() user?: { id?: number }) {
    return this.banksService.createBank(dto, user?.id);
  }

  @Patch(':id')
  @Permissions('banks.manage')
  updateBank(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBankDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.updateBank(id, dto, user?.id);
  }

  @Post('accounts')
  @Permissions('banks.manage')
  createAccount(@Body() dto: CreateBankAccountDto, @GetUser() user?: { id?: number }) {
    return this.banksService.createAccount(dto, user?.id);
  }

  @Patch('accounts/:id')
  @Permissions('banks.manage')
  updateAccount(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBankAccountDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.updateAccount(id, dto, user?.id);
  }

  @Get('transactions')
  @Permissions('banks.view')
  listTransactions(
    @Query('companyId', ParseIntPipe) companyId: number,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.banksService.listTransactions({
      companyId,
      bankAccountId: bankAccountId ? Number(bankAccountId) : undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Post('transactions')
  @Permissions('banks.manage')
  createTransaction(
    @Body() dto: CreateBankTransactionDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.createTransaction(dto, user?.id);
  }

  @Delete('transactions/:id')
  @Permissions('banks.manage')
  deleteTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Query('companyId', ParseIntPipe) companyId: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.softDeleteTransaction(id, companyId, user?.id);
  }
}
