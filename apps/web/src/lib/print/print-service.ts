/**
 * Receipt printing abstraction (item 8). A local print agent will drive the
 * thermal printer + cash-drawer kick later; until then the browser print
 * dialog is the fallback. The POS only ever calls `printService`, so the
 * agent drops in behind this exact interface.
 *
 * The printable receipt itself is a component marked `.print-area`
 * (components/pos/receipt.tsx) — `printReceipt()` assumes it is mounted.
 */

export interface PrintService {
  /** Print the currently mounted `.print-area` receipt. */
  printReceipt(): void;
  /** Fire the cash-drawer kick. No-op until the local agent exists. */
  kickDrawer(): void;
}

const browserPrintService: PrintService = {
  printReceipt() {
    window.print();
  },
  kickDrawer() {
    // Thermal-agent territory — nothing a browser can do. Intentional no-op.
  },
};

/** The live print service — swap for the local print agent here. */
export const printService: PrintService = browserPrintService;
