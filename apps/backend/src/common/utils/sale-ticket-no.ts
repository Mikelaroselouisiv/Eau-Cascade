import { randomUUID } from 'crypto';

/** Numéro de fiche / ticket stable cross-nœuds (dérivé de l’uuid, syncé tel quel). */
export function ticketNoFromUuid(uuid: string): string {
  return String(uuid).replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function newSaleIdentity(): { uuid: string; ticketNo: string } {
  const uuid = randomUUID();
  return { uuid, ticketNo: ticketNoFromUuid(uuid) };
}
