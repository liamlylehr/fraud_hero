# fraud_hero

Forward a suspicious email to one address and find out whether it's a scam.

**Current step:** emails sent to the service address are received by Amazon SES and stored, unchanged, in S3. Nothing reads or answers them yet.

```
sender --> MX (Vercel DNS) --> SES (us-east-1) --> S3 bucket, inbound/
```

- `infra/`: TypeScript CDK app (`lib/fraud-hero-stack.ts` is the whole stack)
- `openspec/`: the plan, specs and design for each step

## Setup

Requires Node 22+ and, for deploying, the AWS CLI with credentials for your account.

```bash
cd infra
npm install
npm test
npx cdk synth
```

## Configuration

Set these in `infra/cdk.json` under `context` (the committed values are placeholders):

| Key | Example | What it is |
|---|---|---|
| `inboundSubdomain` | `fraud.yourdomain.com` | Subdomain SES receives mail for. Your main domain is untouched. |
| `inboundAddress` | `check@fraud.yourdomain.com` | The one address mail is accepted for. Must be on the subdomain. |

The region is fixed to `us-east-1`, one of the regions where SES can receive mail.

## Deploy

```bash
cd infra
npx cdk bootstrap aws://<account-id>/us-east-1   # once per account and region
npx cdk deploy
```

The deploy prints `BucketName` and three DKIM records (`DkimRecord1Name` / `DkimRecord1Value` … `3`). To see them again later:

```bash
aws cloudformation describe-stacks --stack-name FraudHero --region us-east-1 \
  --query "Stacks[0].Outputs" --output table
```

## DNS records in Vercel

Add these on your **parent domain** (Vercel → Domains → yourdomain.com → DNS Records). Vercel names are relative to the parent domain, so drop the trailing `.yourdomain.com` from each name.

| Name | Type | Value | Priority |
|---|---|---|---|
| `fraud` | MX | `inbound-smtp.us-east-1.amazonaws.com` | 10 |
| `<token1>._domainkey.fraud` | CNAME | `DkimRecord1Value` from the outputs | |
| `<token2>._domainkey.fraud` | CNAME | `DkimRecord2Value` | |
| `<token3>._domainkey.fraud` | CNAME | `DkimRecord3Value` | |

For example, the output `DkimRecord1Name = abc123._domainkey.fraud.yourdomain.com` becomes the Vercel name `abc123._domainkey.fraud`.

You can also use the Vercel CLI:

```bash
vercel dns add yourdomain.com fraud MX inbound-smtp.us-east-1.amazonaws.com 10
vercel dns add yourdomain.com abc123._domainkey.fraud CNAME abc123.dkim.amazonses.com
```

## Verify and activate

1. Check that DNS is live and SES has verified the subdomain. This usually takes minutes, but can take up to an hour.

   ```bash
   dig +short MX fraud.yourdomain.com          # expect: 10 inbound-smtp.us-east-1.amazonaws.com.
   aws sesv2 get-email-identity --email-identity fraud.yourdomain.com --region us-east-1 \
     --query "DkimAttributes.Status"           # expect: "SUCCESS"
   ```

2. Check whether another receipt rule set is already active. SES allows only one per region, and activating ours replaces it.

   ```bash
   aws ses describe-active-receipt-rule-set --region us-east-1   # empty output = none active
   ```

3. Activate ours. This is a one-time step that CDK can't do.

   ```bash
   aws ses set-active-receipt-rule-set --rule-set-name fraud-hero --region us-east-1
   ```

## Watching mail land

Send an email to the service address, then:

```bash
BUCKET=<BucketName from the outputs>
aws s3 ls "s3://$BUCKET/inbound/" --region us-east-1
aws s3 cp "s3://$BUCKET/inbound/<object-key>" - --region us-east-1 | head -40   # raw message
```

Each object is the full raw email. The `X-SES-Spam-Verdict` and `X-SES-Virus-Verdict` headers show SES's scan results. Mail to any other address on the subdomain is not stored, and stored mail is deleted after 30 days.

## Rollback

```bash
aws ses set-active-receipt-rule-set --region us-east-1   # no name = deactivate
cd infra && npx cdk destroy
```

Then remove the DNS records in Vercel. The bucket is kept on purpose so mail is never deleted by accident. Empty and delete it in the S3 console if you really want it gone.
