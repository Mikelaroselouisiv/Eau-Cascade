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
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { GetUser } from '../../common/decorators/get-user.decorator';
import {
  collectPdfBuffer,
  createPdfDoc,
  drawFooterNote,
  drawReportHeader,
  drawSectionTitle,
  drawTableHeader,
  drawTableRow,
  generatedMetaLine,
} from '../../common/pdf/pdf-document';
import { formatDateFr, formatDateTimeFr, formatQty } from '../../common/pdf/pdf-format';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { InventoryService } from './inventory.service';
import {
  CreateInventorySessionDto,
  UpdateInventoryLineDto,
} from './dto/physical-inventory.dto';
import { StockAdjustmentDto, StockMovementDto } from './dto/stock-movement.dto';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('sessions')
  @Permissions('inventory.physical')
  createSession(
    @Body() dto: CreateInventorySessionDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.inventoryService.createPhysicalInventorySession(
      dto.departmentId,
      dto.label,
      dto.note,
      user?.id,
      dto.kind ?? undefined,
      dto.onlyPositiveStock === true,
    );
  }

  @Get('sessions')
  @Permissions('inventory.physical')
  listSessions(
    @Query('departmentId') departmentId?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.inventoryService.listInventorySessions(
      InventoryController.parseSessionFilters(departmentId, companyId),
    );
  }

  @Get('count-sheet')
  @Permissions('inventory.physical')
  getCountSheet(
    @Query('departmentId') departmentId?: string,
    @Query('asOf') asOf?: string,
    @Query('onlyPositiveStock') onlyPositiveStockRaw?: string,
  ) {
    const deptId = InventoryController.parsePositiveInt(departmentId);
    if (!deptId) {
      throw new BadRequestException('departmentId est requis.');
    }
    return this.inventoryService.getCountSheetContext(
      deptId,
      asOf?.trim() || undefined,
      InventoryController.parseTruthy(onlyPositiveStockRaw),
    );
  }

  @Get('count-sheet/export/pdf')
  @Permissions('stock.view')
  async exportCountSheetPdf(
    @Res() res: Response,
    @Query('departmentId') departmentId?: string,
    @Query('asOf') asOf?: string,
    @Query('onlyPositiveStock') onlyPositiveStockRaw?: string,
  ) {
    const deptId = InventoryController.parsePositiveInt(departmentId);
    if (!deptId) {
      throw new BadRequestException('departmentId est requis.');
    }
    const sheet = await this.inventoryService.getCountSheetContext(
      deptId,
      asOf?.trim() || undefined,
      InventoryController.parseTruthy(onlyPositiveStockRaw),
    );
    const pdfBuffer = await InventoryController.buildCountSheetPdf(sheet);
    const filenameDate = formatDateFr(new Date()).replace(/\//g, '-');
    const safeName = `${sheet.department.company.name}_${sheet.department.name}`
      .replace(/[^\w\- ]+/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 50);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="feuille_inventaire_${safeName}_${filenameDate}.pdf"`,
    );
    res.send(pdfBuffer);
  }

  @Get('sessions/:id')
  @Permissions('inventory.physical')
  getSession(@Param('id', ParseIntPipe) id: number) {
    return this.inventoryService.getInventorySession(id);
  }

  @Patch('sessions/:sessionId/lines/:lineId')
  @Permissions('inventory.physical')
  updateLine(
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() dto: UpdateInventoryLineDto,
    @GetUser() user?: { id?: number },
  ) {
    return this.inventoryService.updateInventoryLine(sessionId, lineId, dto, user?.id);
  }

  @Post('sessions/:id/complete')
  @Permissions('inventory.physical')
  completeSession(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.inventoryService.completeInventorySession(id, user?.id, true);
  }

  @Post('sessions/:id/cancel')
  @Permissions('inventory.physical')
  cancelSession(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() user?: { id?: number },
  ) {
    return this.inventoryService.cancelInventorySession(id, user?.id);
  }

  @Post('entries')
  @PermissionsAny('stock.manage', 'stock.adjust')
  stockIn(@Body() dto: StockMovementDto, @GetUser() user?: { id?: number }) {
    return this.inventoryService.increaseStock(dto.productId, dto.quantity, dto.reason, user?.id);
  }

  @Post('adjustments')
  @Permissions('stock.adjust')
  adjust(@Body() dto: StockAdjustmentDto, @GetUser() user?: { id?: number }) {
    return this.inventoryService.adjustStock(dto.productId, dto.quantity, dto.reason, user?.id);
  }

  @Get('movements')
  @Permissions('stock.view')
  movements(
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('order') orderRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const parseIntOr = (raw: string | undefined, fallback: number) => {
      if (raw === undefined || raw === '') return fallback;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : fallback;
    };
    const order = orderRaw === 'asc' ? 'asc' : 'desc';
    return this.inventoryService.getMovements({
      skip: parseIntOr(skipRaw, 0),
      take: parseIntOr(takeRaw, 100),
      companyId: companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined,
      order,
      dateFrom: dateFrom?.trim() || undefined,
      dateTo: dateTo?.trim() || undefined,
    });
  }

  @Get('global-snapshot')
  @PermissionsAny('stock.global', 'reports.view')
  globalSnapshot(
    @Query('companyIds') companyIdsRaw?: string,
    @Query('departmentIds') departmentIdsRaw?: string,
    @Query('asOf') asOf?: string,
  ) {
    const parseIds = (raw?: string) =>
      raw
        ?.split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
    return this.inventoryService.getGlobalStockSnapshot({
      companyIds: parseIds(companyIdsRaw),
      departmentIds: parseIds(departmentIdsRaw),
      asOf: asOf?.trim() || undefined,
    });
  }

  @Get('global-snapshot/export/pdf')
  @PermissionsAny('stock.global', 'reports.view')
  async exportGlobalSnapshotPdf(
    @Res() res: Response,
    @Query('companyIds') companyIdsRaw?: string,
    @Query('departmentIds') departmentIdsRaw?: string,
    @Query('asOf') asOf?: string,
  ) {
    const parseIds = (raw?: string) =>
      raw
        ?.split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
    const snapshot = await this.inventoryService.getGlobalStockSnapshot({
      companyIds: parseIds(companyIdsRaw),
      departmentIds: parseIds(departmentIdsRaw),
      asOf: asOf?.trim() || undefined,
    });

    const companyNames = [
      ...new Set(
        snapshot.items
          .map((i) => i.company?.name?.trim())
          .filter((n): n is string => Boolean(n)),
      ),
    ];
    const brandName =
      companyNames.length === 1 ? companyNames[0] : companyNames.join(', ') || 'POS Eau Cascade';

    const asOfLabel = snapshot.asOf
      ? `Stock au ${formatDateTimeFr(snapshot.asOf)} (rétrospection)`
      : `Stock actuel · ${formatDateTimeFr(snapshot.generatedAt)}`;

    const doc = createPdfDoc({ landscape: true });
    await drawReportHeader(doc, {
      title: 'Inventaire global',
      brand: { companyName: brandName },
      metaLines: [
        `Produits : ${snapshot.items.length}`,
        asOfLabel,
        generatedMetaLine(),
      ],
    });

    if (snapshot.items.length === 0) {
      doc.fontSize(11).fillColor('#64748b').text('Aucun produit.');
    } else {
      const cols = [
        { key: 'company', label: 'Entreprise', width: 175 },
        { key: 'dept', label: 'Département', width: 110 },
        { key: 'name', label: 'Produit', width: 195 },
        { key: 'sku', label: 'Réf.', width: 42 },
        { key: 'unit', label: 'Unité', width: 55 },
        { key: 'stock', label: 'Stock', width: 55, align: 'right' as const },
        { key: 'min', label: 'Min', width: 40, align: 'right' as const },
        { key: 'status', label: 'Statut', width: 48, align: 'center' as const },
      ];
      drawTableHeader(doc, cols);
      snapshot.items.forEach((item, i) => {
        drawTableRow(
          doc,
          cols,
          {
            company: item.company?.name ?? '—',
            dept: item.department?.name ?? '—',
            name: item.name,
            sku: item.sku ?? '—',
            unit: item.unitLabel,
            stock: formatQty(item.stock),
            min: formatQty(item.stockMin),
            status: item.lowStock ? 'Bas' : 'OK',
          },
          { alt: i % 2 === 1 },
        );
      });
    }

    const pdfBuffer = await collectPdfBuffer(doc);
    const filenameDate = formatDateFr(new Date()).replace(/\//g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="inventaire_global_${filenameDate}.pdf"`,
    );
    res.send(pdfBuffer);
  }

  @Get('alerts')
  @Permissions('stock.view')
  alerts(
    @Query('threshold') threshold?: string,
    @Query('companyId') companyIdRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    const skip = skipRaw ? Number.parseInt(skipRaw, 10) : 0;
    const take = takeRaw ? Number.parseInt(takeRaw, 10) : 10;
    return this.inventoryService.getLowStockAlerts(Number(threshold ?? 5), companyId, { skip, take });
  }

  @Get('alerts/zero')
  @Permissions('stock.view')
  zeroAlerts(
    @Query('companyId') companyIdRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('take') takeRaw?: string,
  ) {
    const companyId = companyIdRaw ? Number.parseInt(companyIdRaw, 10) : undefined;
    const skip = skipRaw ? Number.parseInt(skipRaw, 10) : 0;
    const take = takeRaw ? Number.parseInt(takeRaw, 10) : 8;
    return this.inventoryService.getZeroStockAlerts(companyId, { skip, take });
  }

  @Get('sessions/export/pdf')
  @Permissions('stock.view')
  async exportInventorySessionsPdf(
    @Res() res: Response,
    @Query('departmentId') departmentId?: string,
    @Query('companyId') companyId?: string,
    @Query('take') takeRaw?: string,
  ) {
    const parseIntOr = (raw: string | undefined, fallback: number) => {
      if (raw === undefined || raw === '') return fallback;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : fallback;
    };

    const filters = InventoryController.parseSessionFilters(departmentId, companyId);
    const take = parseIntOr(takeRaw, 80);

    const sessions = await this.inventoryService.listInventorySessionsForExport(filters, take);

    const statusLabel = (s: string) => {
      switch (s) {
        case 'DRAFT':
          return 'Brouillon';
        case 'COMPLETED':
          return 'Validé';
        case 'CANCELLED':
          return 'Annulé';
        default:
          return s;
      }
    };

    const filterLabel = InventoryController.describeSessionFilter(filters, sessions);
    const logoUrl =
      (sessions[0]?.department?.company as { logoUrl?: string | null } | undefined)?.logoUrl ??
      null;
    const brandName = sessions[0]?.department?.company?.name ?? 'POS Eau Cascade';

    const doc = createPdfDoc();
    await drawReportHeader(doc, {
      title: 'Historique des inventaires',
      brand: { companyName: brandName, logoUrl },
      metaLines: [
        `Périmètre : ${filterLabel}`,
        `Sessions exportées : ${sessions.length}`,
        generatedMetaLine(),
      ],
    });

    if (sessions.length === 0) {
      doc.fontSize(11).fillColor('#64748b').text('Aucune session trouvée pour ce filtre.');
    } else {
      const lineCols = [
        { key: 'name', label: 'Produit', width: 200 },
        { key: 'unit', label: 'Unité', width: 70 },
        { key: 'open', label: 'Stock', width: 70, align: 'right' as const },
        { key: 'counted', label: 'Compté', width: 70, align: 'right' as const },
        { key: 'var', label: 'Écart', width: 70, align: 'right' as const },
      ];

      for (const s of sessions) {
        const kindLabels: Record<string, string> = {
          OPENING: 'Ouverture de période',
          CLOSING: 'Clôture de période',
          AD_HOC: 'Contrôle ponctuel',
        };
        const kindText = kindLabels[(s as { kind?: string }).kind ?? 'AD_HOC'] ?? 'Contrôle ponctuel';
        drawSectionTitle(
          doc,
          `Session #${s.id} — ${s.label ?? 'Sans libellé'}`,
        );
        doc
          .fillColor('#64748b')
          .fontSize(9)
          .text(
            `${kindText} · ${s.department.company.name} — ${s.department.name} · ${statusLabel(s.status)}`,
          );
        doc.text(
          `Créée : ${formatDateTimeFr(s.createdAt)}${
            s.completedAt ? ` · Clôturée : ${formatDateTimeFr(s.completedAt)}` : ''
          }`,
        );
        if (s.note) doc.text(`Note : ${s.note}`);
        doc.moveDown(0.25);

        const lines = s.lines ?? [];
        drawTableHeader(doc, lineCols);
        lines.forEach((line, i) => {
          const product = line.product;
          const open = Number(line.systemQtyAtOpen);
          const counted = line.countedQty != null ? Number(line.countedQty) : null;
          const variance = counted != null ? counted - open : null;
          const unit =
            product.saleUnits?.[0]?.packagingUnit?.label ??
            product.saleUnits?.[0]?.packagingUnit?.code ??
            '—';
          const sku = product.sku ? ` [${product.sku}]` : '';
          drawTableRow(
            doc,
            lineCols,
            {
              name: `${product.name}${sku}`,
              unit,
              open: formatQty(open),
              counted: counted != null ? formatQty(counted) : '—',
              var: variance != null ? formatQty(variance) : '—',
            },
            { alt: i % 2 === 1 },
          );
        });
        doc.moveDown(0.55);
      }
    }

    const pdfBuffer = await collectPdfBuffer(doc);
    const filenameDate = formatDateFr(new Date()).replace(/\//g, '-');
    const safeFilter = filterLabel.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 40);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="historique_inventaires_${safeFilter}_${filenameDate}.pdf"`,
    );
    res.send(pdfBuffer);
  }

  private static parsePositiveInt(raw?: string): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  private static parseTruthy(raw?: string): boolean {
    if (raw === undefined || raw === '') return false;
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  private static parseSessionFilters(
    departmentId?: string,
    companyId?: string,
  ): { departmentId?: number; companyId?: number } {
    const deptId = InventoryController.parsePositiveInt(departmentId);
    const compId = InventoryController.parsePositiveInt(companyId);
    if (deptId) return { departmentId: deptId };
    if (compId) return { companyId: compId };
    return {};
  }

  private static describeSessionFilter(
    filters: { departmentId?: number; companyId?: number },
    sessions: Array<{ department: { name: string; company: { name: string } } }>,
  ): string {
    if (filters.departmentId && sessions[0]) {
      return `${sessions[0].department.company.name} — ${sessions[0].department.name}`;
    }
    if (filters.companyId && sessions[0]) {
      return `${sessions[0].department.company.name} (tous départements)`;
    }
    return 'Toutes les entreprises';
  }

  private static async buildCountSheetPdf(sheet: {
    generatedAt: string;
    asOf?: string | null;
    department: {
      name: string;
      company: { name: string; logoUrl?: string | null };
    };
    products: Array<{
      name: string;
      sku: string | null;
      stock: number;
      unitLabel: string;
    }>;
  }): Promise<Buffer> {
    const doc = createPdfDoc({ landscape: true });
    const stockLabel = sheet.asOf
      ? `Stock système rétrospectif au ${formatDateTimeFr(sheet.asOf)}`
      : `Stock système au ${formatDateTimeFr(sheet.generatedAt)}`;
    await drawReportHeader(doc, {
      title: 'Feuille d’inventaire physique',
      brand: {
        companyName: sheet.department.company.name,
        logoUrl: sheet.department.company.logoUrl,
        subtitle: sheet.department.name,
      },
      metaLines: [stockLabel, generatedMetaLine()],
    });

    if (sheet.products.length === 0) {
      doc.fontSize(11).fillColor('#64748b').text('Aucun produit avec stock suivi dans ce département.');
    } else {
      const cols = [
        { key: 'n', label: '#', width: 28, align: 'right' as const },
        { key: 'name', label: 'Produit', width: 260 },
        { key: 'sku', label: 'Réf.', width: 48 },
        { key: 'unit', label: 'Unité', width: 80 },
        { key: 'stock', label: 'Stock syst.', width: 80, align: 'right' as const },
        { key: 'counted', label: 'Compté', width: 80, align: 'center' as const },
        { key: 'var', label: 'Écart', width: 80, align: 'center' as const },
      ];
      drawTableHeader(doc, cols);
      sheet.products.forEach((p, i) => {
        drawTableRow(
          doc,
          cols,
          {
            n: String(i + 1),
            name: p.name,
            sku: p.sku ?? '—',
            unit: p.unitLabel,
            stock: formatQty(p.stock),
            counted: '________',
            var: '________',
          },
          { alt: i % 2 === 1 },
        );
      });
    }

    drawFooterNote(
      doc,
      'Notez la quantité comptée sur le terrain. Écart = compté − stock système. ' +
        'Pour enregistrer les ajustements dans le POS, utilisez une session de comptage dans l’application.',
    );

    return collectPdfBuffer(doc);
  }
}
