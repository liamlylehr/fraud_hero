# Proposal

## Why

Fraud Hero starts with mom forwarding suspicious emails to one address. Before building anything that reads or answers those emails, we need to know the hardest external piece works: real mail sent to our own subdomain lands in AWS where we can see it. This is the first of several small, separately deployable steps.

## What Changes

- Receive email with Amazon SES for a dedicated subdomain (for example `fraud.<domain>`) hosted on Vercel DNS, at a single configured address (for example `check@fraud.<domain>`).
- Store each received email unchanged (raw MIME) in a private S3 bucket under `inbound/`, with SES spam and virus scanning results recorded in the stored mail.
- Expire stored emails after 30 days, so unprocessed mail and spam don't pile up.
- Define all of this in a new TypeScript CDK app. The subdomain and address are config values.
- Document the manual steps CDK can't do: adding the DNS records in Vercel, and activating the SES receipt rule set.

Not in this change: a sender allowlist, any processing (queue, Lambda, model), and replies. The allowlist is deferred to the next step and **must ship no later than the first step that acts on stored mail**.

## Capabilities

### New Capabilities
- `email-intake`: receiving forwarded emails at the service address and storing them for later processing. Later steps add sender checks and content extraction to this capability.

### Modified Capabilities
<!-- None: this is a new project. -->

## Impact

- **New code:** `infra/`, a TypeScript CDK app with one stack and its assertion tests, plus a README section on setup and monitoring.
- **AWS resources (us-east-1):** an SES domain identity for the subdomain, an SES receipt rule set with one rule, and an S3 bucket.
- **DNS (manual, Vercel):** one MX record and three DKIM CNAME records on the subdomain.
- **Account-level side effect:** SES allows one active receipt rule set per region. Activating ours replaces any rule set already active in us-east-1, so check before activating.
- **Exposure:** until the allowlist lands, anyone who knows the address can get mail stored in the bucket. Nothing reads it yet, so the impact is limited to storage, which the 30-day expiry bounds.
