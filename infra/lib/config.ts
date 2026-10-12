export interface InboundConfig {
  inboundSubdomain: string;
  inboundAddress: string;
}

/**
 * Read and check the inbound settings from cdk.json context.
 * Throws before any resources are defined, so a bad config never half-deploys.
 */
export function readConfig(get: (key: string) => unknown): InboundConfig {
  const subdomain = String(get("inboundSubdomain") ?? "").trim().toLowerCase();
  const address = String(get("inboundAddress") ?? "").trim().toLowerCase();

  if (!subdomain) throw new Error('Missing "inboundSubdomain" in cdk.json context (e.g. "fraud.example.com").');
  if (!address) throw new Error('Missing "inboundAddress" in cdk.json context (e.g. "check@fraud.example.com").');
  // SES only receives for the verified subdomain, so an address elsewhere would silently never arrive.
  if (!address.endsWith(`@${subdomain}`)) {
    throw new Error(`"inboundAddress" (${address}) must be on "inboundSubdomain" (${subdomain}).`);
  }
  return { inboundSubdomain: subdomain, inboundAddress: address };
}
