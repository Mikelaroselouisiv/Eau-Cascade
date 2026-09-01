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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DonationsService } from './donations.service';
import {
  CreateDonationBeneficiaryDto,
  CreateDonationDto,
  UpdateDonationBeneficiaryDto,
} from './dto/donation.dto';

type ScopeUser = {
  id: number;
  role?: string | null;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
};

@Controller('donations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions('donation.view')
export class DonationsController {
  constructor(private readonly donations: DonationsService) {}

  @Get('summary')
  summary(@Query('companyId', ParseIntPipe) companyId: number) {
    return this.donations.summary(companyId);
  }

  @Get('beneficiaries')
  listBeneficiaries(
    @Query('companyId', ParseIntPipe) companyId: number,
    @Query('q') q?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.donations.listBeneficiaries(companyId, {
      q,
      includeInactive: includeInactive === '1' || includeInactive === 'true',
    });
  }

  @Get('beneficiaries/:id')
  getBeneficiary(@Param('id', ParseIntPipe) id: number) {
    return this.donations.getBeneficiary(id);
  }

  @Post('beneficiaries')
  @Permissions('donation.manage')
  createBeneficiary(
    @Body() dto: CreateDonationBeneficiaryDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.donations.createBeneficiary(dto, user?.id);
  }

  @Patch('beneficiaries/:id')
  @Permissions('donation.manage')
  updateBeneficiary(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDonationBeneficiaryDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.donations.updateBeneficiary(id, dto, user?.id);
  }

  @Get()
  listDonations(
    @Query('companyId', ParseIntPipe) companyId: number,
    @Query('beneficiaryId') beneficiaryRaw?: string,
    @Query('departmentId') departmentRaw?: string,
  ) {
    const beneficiaryId = beneficiaryRaw ? Number.parseInt(beneficiaryRaw, 10) : undefined;
    const departmentId = departmentRaw ? Number.parseInt(departmentRaw, 10) : undefined;
    return this.donations.listDonations({
      companyId,
      beneficiaryId: Number.isFinite(beneficiaryId) && beneficiaryId! > 0 ? beneficiaryId : undefined,
      departmentId: Number.isFinite(departmentId) && departmentId! > 0 ? departmentId : undefined,
    });
  }

  @Post()
  @Permissions('donation.manage')
  createDonation(@Body() dto: CreateDonationDto, @GetUser() user: ScopeUser) {
    return this.donations.createDonation(dto, user);
  }
}
