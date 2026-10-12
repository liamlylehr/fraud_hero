# Tasks

## 1. CDK Project Setup

- [x] 1.1 Create `infra/` as a TypeScript CDK app (`package.json` with `"type": "module"`, `tsconfig.json`, `cdk.json`, `bin/app.ts`, an empty `lib/fraud-hero-stack.ts`, `.gitignore` for `node_modules/` and `cdk.out/`), with region fixed to `us-east-1`. Verify `npx cdk synth` succeeds and `npx tsc --noEmit` passes.
- [x] 1.2 Add `inboundSubdomain` and `inboundAddress` to `cdk.json` context, with validation that throws a clear error when either is missing or the address isn't on the subdomain. Verify with tests on the node test runner (`npm test`) covering valid config, each missing value, and a mismatched domain.

## 2. Storage

- [x] 2.1 Add the S3 bucket: block public access, S3-managed encryption, SSL enforced, retained on delete, and `inbound/` expiring after 30 days. Verify with CDK assertion tests for each property.

## 3. SES Receiving

- [x] 3.1 Add the SES `EmailIdentity` for the subdomain (Easy DKIM), and output the three DKIM CNAME names and values plus the bucket name as stack outputs. Verify with assertion tests that the identity and the outputs exist.
- [x] 3.2 Add the receipt rule set with one rule: recipient = the exact service address, scanning enabled, and an S3 action writing to `inbound/`. Verify with assertion tests on the recipient list, `ScanEnabled`, the S3 action prefix, and the bucket policy that lets SES write.

## 4. Documentation

- [x] 4.1 Update `README.md` with: setup (`npm install`, `npm test`, `cdk synth`), configuration, deploy, the Vercel records (MX value plus the DKIM outputs), the verification check, the active-rule-set check and activation commands, how to watch `inbound/`, and rollback. Verify every local command in it runs as written.

## 5. Live Check

- [x] 5.1 Deploy, add the DNS records in Vercel, wait for the identity to verify, check for an existing active rule set, and activate ours. Then: send an email to the service address and confirm one object appears under `inbound/` with the full message and `X-SES-Spam-Verdict`/`X-SES-Virus-Verdict` headers, and send one to another address on the subdomain and confirm nothing is stored.
