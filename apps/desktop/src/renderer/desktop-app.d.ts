export {};

declare global {
  interface Window {
    desktopApp?: {
      platform: string;
      printReceipt?: (saleData: {
        /** Pour nom de fichier PDF (réimpression / export). */
        saleId?: number;
        documentType?: 'RECEIPT' | 'DISBURSEMENT_ORDER';
        companyName: string;
        companyPhone?: string | null;
        address: string;
        cashier: string;
        dateTime?: string;
        items: Array<{ name: string; qty: number; price: number }>;
        total: number;
        amountReceived?: number;
        changeDue?: number;
        balanceDue?: number;
        paymentMode: string;
        paperWidth?: 58 | 80;
        printerName?: string;
        receiptHeaderText?: string | null;
        receiptFooterText?: string | null;
        receiptClientName?: string | null;
        receiptLogoUrl?: string | null;
        showLogoOnReceipt?: boolean;
        autoCut?: boolean;
        isTest?: boolean;
        previewSampleBody?: string | null;
        description?: string;
        amount?: number;
        entryDate?: string;
        entryId?: number;
        preparedBy?: string;
      }) => Promise<{ ok: boolean; mode: string; reason?: string; ticketText?: string }>;
      listPrinters?: () => Promise<Array<{ name: string }>>;
      /** SQLite local (file d’attente ventes + cache catalogue). */
      localDb?: {
        outboxEnqueue: (payload: unknown) => Promise<string>;
        outboxList: () => Promise<Array<{ id: string; payload: unknown }>>;
        outboxRemove: (id: string) => Promise<void>;
        cacheSet: (key: string, json: string) => Promise<void>;
        cacheGet: (key: string) => Promise<string | null>;
      };
    };
  }
}
