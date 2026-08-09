/**
 * Jobber GraphQL query documents + raw response types.
 *
 * Field names follow Jobber's documented schema (verified 2025-07 against the
 * public API reference): `jobs`/`quotes`/`invoices`/`requests` are Relay
 * connections; status enums are `jobStatus`/`quoteStatus`/`invoiceStatus`.
 *
 * These are NOT validated against a live token yet. If Jobber renames a field,
 * fix it HERE — lib/jobber/sync.ts reads every field defensively, so a rename is
 * a one-line isolated change with a clear runtime warning pointing at it.
 */

export const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
export const JOBBER_AUTHORIZE_URL = 'https://api.getjobber.com/api/oauth/authorize';
export const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
export const DEFAULT_JOBBER_API_VERSION = '2025-04-16';

const PAGE = 50;

export const JOBS_QUERY = /* GraphQL */ `
  query OpsJobs($after: String) {
    jobs(first: ${PAGE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        jobNumber
        title
        jobStatus
        total
        startAt
        endAt
        client { id name }
        property { address { street city province postalCode } }
      }
    }
  }
`;

export const QUOTES_QUERY = /* GraphQL */ `
  query OpsQuotes($after: String) {
    quotes(first: ${PAGE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        quoteNumber
        quoteStatus
        amounts { total }
        createdAt
        client { id name }
      }
    }
  }
`;

export const INVOICES_QUERY = /* GraphQL */ `
  query OpsInvoices($after: String) {
    invoices(first: ${PAGE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        invoiceNumber
        invoiceStatus
        amounts { total paymentsTotal }
        issuedDate
        dueDate
        client { id name }
      }
    }
  }
`;

export const REQUESTS_QUERY = /* GraphQL */ `
  query OpsRequests($after: String) {
    requests(first: ${PAGE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        requestStatus
        createdAt
        client { id name emails { address } phones { number } }
      }
    }
  }
`;

// ── Raw response shapes (all fields optional — Jobber may omit or rename) ──────
export interface JobberPageInfo {
  hasNextPage?: boolean;
  endCursor?: string | null;
}
export interface JobberConnection<T> {
  pageInfo?: JobberPageInfo;
  nodes?: (T | null)[];
}
export interface JobberClientRef {
  id?: string;
  name?: string;
  emails?: ({ address?: string } | null)[];
  phones?: ({ number?: string } | null)[];
}
export interface JobberJobNode {
  id?: string;
  jobNumber?: number | string;
  title?: string;
  jobStatus?: string;
  total?: number;
  startAt?: string;
  endAt?: string;
  client?: JobberClientRef;
  property?: { address?: { street?: string; city?: string; province?: string; postalCode?: string } };
}
export interface JobberQuoteNode {
  id?: string;
  quoteNumber?: number | string;
  quoteStatus?: string;
  amounts?: { total?: number };
  createdAt?: string;
  client?: JobberClientRef;
}
export interface JobberInvoiceNode {
  id?: string;
  invoiceNumber?: number | string;
  invoiceStatus?: string;
  amounts?: { total?: number; paymentsTotal?: number };
  issuedDate?: string;
  dueDate?: string;
  client?: JobberClientRef;
}
export interface JobberRequestNode {
  id?: string;
  title?: string;
  requestStatus?: string;
  createdAt?: string;
  client?: JobberClientRef;
}
