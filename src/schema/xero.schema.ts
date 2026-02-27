export interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token?: string;
  token_type?: string;
}

export interface LineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
}

export interface QuoteData {
  contactId: string;
  reference: string;
  date: string;
  expiryDate: string;
  lineItems: LineItem[];
}

export interface Quote {
  QuoteID: string;
  QuoteNumber: string;
  Type: 'ACCREC' | 'ACCPAY';
  Status: string;
  UpdatedDateUTC: string;
  LineItems: LineItem[];
  Contact: Contact;
  Date?: string;
  DateString?: string;
  ExpiryDate?: string;
  ExpiryDateString?: string;
  CurrencyCode?: string;
  SubTotal?: number;
  Total?: number;
  TotalDiscount?: number;
  TotalTax?: number;
  BrandingThemeID?: string;
  LineAmountTypes?: string;
  Reference?: string;
}

export interface Contact {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
}

export interface XeroWebhookEvent {
  resourceUrl: string;
  resourceId: string;
  tenantId: string;
  tenantType: 'ORGANISATION' | string;
  eventCategory: 'INVOICE' | 'CONTACT' | 'SUBSCRIPTION' | string;
  eventType: 'CREATE' | 'UPDATE' | 'DELETE';
  eventDateUtc: string;
}

export interface XeroWebhookPayload {
  events: XeroWebhookEvent[];
  firstEventSequence: number;
  lastEventSequence: number;
  entropy: string;
}

export interface PurchaseOrder {
  PurchaseOrderID: string;
  PurchaseOrderNumber: string;
  Status: string;
  UpdatedDateUTC: string;
  Contact: {
    ContactID: string;
    Name: string;
  };
  DateString?: string;
  DeliveryDateString?: string;
  LineItems?: any[];
  Total?: number;
  [key: string]: any; // catch-all for extra fields
}
