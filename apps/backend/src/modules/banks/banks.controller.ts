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
import { Roles } from '../../common/decorators/roles.decorator';
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
@Roles('ADMIN', 'MANAGER')
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @Get('summary')
  summary(@Query('companyId', ParseIntPipe) companyId: number) {
    return this.banksService.summary(companyId);
  }

  @Get()
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
  createBank(@Body() dto: CreateBankDto, @GetUser() user?: { id?: number }) {
    return this.banksService.createBank(dto, user?.id);
  }

  @Patch(':id')
  updateBank(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBankDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.updateBank(id, dto, user?.id);
  }

  @Post('accounts')
  createAccount(@Body() dto: CreateBankAccountDto, @GetUser() user?: { id?: number }) {
    return this.banksService.createAccount(dto, user?.id);
  }

  @Patch('accounts/:id')
  updateAccount(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBankAccountDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.updateAccount(id, dto, user?.id);
  }

  @Get('transactions')
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
  createTransaction(
    @Body() dto: CreateBankTransactionDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.createTransaction(dto, user?.id);
  }

  @Delete('transactions/:id')
  @Roles('ADMIN')
  deleteTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Query('companyId', ParseIntPipe) companyId: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.banksService.softDeleteTransaction(id, companyId, user?.id);
  }
}
