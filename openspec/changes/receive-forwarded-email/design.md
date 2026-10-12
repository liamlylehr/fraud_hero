# Design

## Context

This is a new repo: only a README and OpenSpec. See `proposal.md` for the motivation and `specs/email-intake/spec.md` for the required behavior. DNS for the parent domain lives on Vercel, so CDK can't create DNS records. Those are a manual step after the first deploy.

## Goals / Non-Goals

**Goals:**
- The smallest stack that proves mail reaches AWS: one SES identity, one receipt rule, one bucket.
- A stack that later steps extend (queue, processing) without restructuring.
- Code that reads easily: few files, short comments that explain *why*.

**Non-Goals:**
- Sender filtering, processing or replies (later changes).
- Managing DNS from code.
- Monitoring beyond listing the bucket.

## Architecture

```
 sender --> MX (Vercel DNS) --> SES inbound, us-east-1
                                   |
                     receipt rule set "fraud-hero"
                       rule: recipient = service address, scan on
                       action: S3 --> s3://<bucket>/inbound/<messageId>
                                   |
                                   v
                          S3 bucket (private, SSE, TLS-only,
                                     inbound/ expires after 30 days)
```

## Decisions

### SES receipt rule with a single S3 action
SES writes the raw message straight to S3. No Lambda is needed to store mail, and S3-first is also the shape later steps build on (an S3 event will feed a queue).
*Alternative:* an SNS action. Rejected because SNS has a 150 KB size limit and adds a moving part.

### The recipient condition is the full address
The rule matches the exact service address, not the whole subdomain, so stray or guessed addresses on the subdomain are dropped by SES (spec: only the service address is accepted).

### Scanning on
`scanEnabled: true` makes SES add `X-SES-Spam-Verdict` / `X-SES-Virus-Verdict` headers. It costs nothing and gives later steps a signal for free.

### A domain identity for the subdomain, DKIM tokens as stack outputs
CDK creates an `EmailIdentity` for the subdomain with Easy DKIM. The three DKIM CNAME names and values are stack outputs, so after `cdk deploy` they can be copied into Vercel as-is. The MX value is fixed per region (`10 inbound-smtp.us-east-1.amazonaws.com`) and is documented in the README.

### Rule set activation stays manual
CDK creates the rule set but can't make it active. Activation is account-wide and replaces any other active set, so it is a deliberate, documented one-time command (`aws ses set-active-receipt-rule-set`), preceded by a check (`aws ses describe-active-receipt-rule-set`).

### Bucket settings
Block all public access, S3-managed encryption, `enforceSSL`, and a lifecycle rule expiring `inbound/` after 30 days. The bucket is **retained** on stack deletion, so destroying the stack never silently deletes received mail. SES's receipt-rule action adds the bucket policy that lets SES write.

### Configuration
`infra/cdk.json` context holds `inboundSubdomain` (e.g. `fraud.example.com`) and `inboundAddress` (e.g. `check@fraud.example.com`). A small validation runs before any constructs are created and throws a clear error if either is missing or the address isn't on the subdomain. These values aren't personal data, so committing them is fine. Region is fixed to `us-east-1` in the app entry point.

### Tooling
TypeScript CDK (`aws-cdk-lib`), run with `tsx`, with tests on Node's built-in test runner using `aws-cdk-lib/assertions`. There's no Jest and no build step. ESM (`"type": "module"`).

### Code style
- One stack file, small and flat, with a short comment wherever a choice isn't obvious (such as why the bucket is retained, or why activation is manual).
- Comments say *why*, not *what*.

## Risks / Trade-offs

- **[Activating replaces an existing active rule set]** → The README check command runs first. If one exists, add our rule to it instead (decided at that point).
- **[Anyone can get mail stored until the allowlist ships]** → Nothing processes it, scanning flags junk, and the 30-day expiry bounds storage. The next change must add the allowlist before any processing.
- **[DNS propagation or verification delay]** → The README says to wait for `VerificationStatus: SUCCESS` before testing.
- **[A retained bucket survives `cdk destroy`]** → Intended. Delete it manually if you really want it gone.

## Migration Plan

1. `cdk deploy` (creates the identity, rule set and bucket; outputs the DKIM records).
2. Add the MX and three CNAMEs in Vercel.
3. Wait for the SES identity to verify.
4. Check for an active rule set, then activate ours.
5. Send test mail and list `inbound/`.

Rollback: deactivate the rule set (`aws ses set-active-receipt-rule-set` with no name), remove the DNS records, and `cdk destroy`.

## Open Questions

- The exact subdomain and address names. These are config values that don't affect the design.
