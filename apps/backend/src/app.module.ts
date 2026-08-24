import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BanksModule } from './modules/banks/banks.module';
import { CompanyModule } from './modules/company/company.module';
import { CreditModule } from './modules/credit/credit.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { PackagingModule } from './modules/packaging/packaging.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { RecipesModule } from './modules/recipes/recipes.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { FinanceModule } from './modules/finance/finance.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProductsModule } from './modules/products/products.module';
import { ProductFamiliesModule } from './modules/product-families/product-families.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RegisterSessionsModule } from './modules/register-sessions/register-sessions.module';
import { RolesModule } from './modules/roles/roles.module';
import { SalesModule } from './modules/sales/sales.module';
import { StoresModule } from './modules/stores/stores.module';
import { SyncModule } from './modules/sync/sync.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig],
    }),
    PrismaModule,
    RolesModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CompanyModule,
    PackagingModule,
    ProductsModule,
    ProductFamiliesModule,
    SalesModule,
    CreditModule,
    BanksModule,
    DeliveriesModule,
    InventoryModule,
    PaymentsModule,
    ReportsModule,
    RegisterSessionsModule,
    DepartmentsModule,
    StoresModule,
    FinanceModule,
    AccountingModule,
    PurchasingModule,
    RecipesModule,
    SyncModule,
  ],
})
export class AppModule {}
