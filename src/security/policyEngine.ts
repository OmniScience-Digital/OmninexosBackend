// src/security/policyEngine.ts
export const rateLimitProfiles = {
  strict: { max: 5, windowMs: 60 * 1000 },
  normal: { max: 20, windowMs: 60 * 1000 },
  relaxed: { max: 60, windowMs: 60 * 1000 },

  // Xero quote creation (frontend -> Xero)
  'xero:createQuote': { max: 20, windowMs: 60 * 1000 },

  // CRM Shaughn sync (single-list minified Xero -> ClickUp sync)
  'crmShaughn:sync': { max: 30, windowMs: 60 * 1000 },
  'crmShaughn:resync': { max: 10, windowMs: 60 * 1000 },
} as const;

export type RateLimitKey = keyof typeof rateLimitProfiles;
export type RateLimitConfig = { max: number; windowMs?: number };

export const resolveRateLimit = (
  policy?: RateLimitKey | RateLimitConfig
): RateLimitConfig | undefined => {
  if (!policy) return undefined;
  if (typeof policy === 'string') return rateLimitProfiles[policy];
  return policy;
};
