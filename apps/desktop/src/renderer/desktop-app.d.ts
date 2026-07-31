export {};

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export type UpdaterStatus = {
  state: UpdaterState;
  version?: string;
  currentVersion?: string;
  percent?: number;
  message?: string;
  enabled?: boolean;
};

declare global {
  interface Window {
    desktopApp?: {
      platform: string;
      getVersion?: () => Promise<string>;
      getEdition?: () => Promise<'server' | 'remote'>;
      printReceipt?: (saleData: {
        /** Pour nom de fichier PDF (réimpression / export). */
        saleId?: number;
        /** Numéro de fiche affiché sur le ticket (stable sync). */
        ticketNo?: string;
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
        detail?: string;
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
      updater?: {
        getStatus: () => Promise<UpdaterStatus>;
        check: () => Promise<UpdaterStatus>;
        quitAndInstall: () => Promise<{ ok: boolean; reason?: string }>;
        onStatus: (callback: (status: UpdaterStatus) => void) => () => void;
      };
    };
  }
}
