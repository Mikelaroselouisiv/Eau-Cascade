import { getInventoryCountSheet, getProducts } from './api';
import type { InventoryCountSheetRow, Product } from '../types/api';
import { stockPackagingLabel } from '../utils/packagingDisplay';
import { productEnforcesSaleStock } from '../utils/user-scope';

function productToCountRow(p: Product): InventoryCountSheetRow {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    stock: Number(p.stock) || 0,
    unitLabel: stockPackagingLabel(p),
  };
}

/**
 * Feuille de comptage pour ouvrir/fermer la caisse (Remote et Server).
 * `/inventory/count-sheet` exige `inventory.physical`, souvent absent (caissier, livreur, rôles custom).
 * Fallback : catalogue `products.view`, déjà requis pour la caisse.
 */
export async function loadRegisterCountRows(departmentId: number): Promise<{
  products: InventoryCountSheetRow[];
  companyId?: number;
}> {
  try {
    const sheet = await getInventoryCountSheet(departmentId);
    return {
      products: sheet.products,
      companyId: sheet.department.company.id,
    };
  } catch {
    const catalog = await getProducts(departmentId);
    const products = catalog
      .filter((p) => productEnforcesSaleStock(p))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
      .map(productToCountRow);
    const companyId =
      catalog.find((p) => p.companyId != null)?.companyId ??
      catalog.find((p) => p.company?.id != null)?.company?.id;
    return { products, companyId };
  }
}
