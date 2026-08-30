export class BillingSessionService {
  openInvoiceSession(accountId: string): string {
    return `billing-${accountId}`;
  }
}
