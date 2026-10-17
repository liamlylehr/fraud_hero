# fraud_hero

Forward a suspicious email to one address and find out whether it's a scam.

**Current step:** emails sent to the service address are received by Amazon SES, stored unchanged in S3, and queued for processing. The processor (`hero_lambda`) only logs which email arrived. It doesn't read or answer anything yet.

```
sender --> MX (Vercel DNS) --> SES (us-east-1) --> S3 inbound/ --> SQS --> hero_lambda (logs arrival)
                                                                    |
                                                                    +--> dead-letter queue after 3 failures
```

- `infra/`: TypeScript CDK app (`lib/fraud-hero-stack.ts` is the whole stack)
- `hero_lambda/`: the Python processor (`handler.py`, standard library only)
- `openspec/`: the plan, specs and design for each step

## Setup

Requires Node 22+, Python 3.12+ with [uv](https://docs.astral.sh/uv/), and the AWS CLI. The `Makefile` uses the AWS profile `fraud-hero` (override with `make <target> AWS_PROFILE=...`).

```bash
make install   # npm install + uv sync
make test      # infra and hero_lambda tests
make synth
make help      # all targets
```

## Configuration

Set these in `infra/cdk.json` under `context`:

| Key | Example | What it is |
|---|---|---|
| `inboundSubdomain` | `fraud.yourdomain.com` | Subdomain SES receives mail for. Your main domain is untouched. |
| `inboundAddress` | `check@fraud.yourdomain.com` | The one address mail is accepted for. Must be on the subdomain. |

The region is fixed to `us-east-1`, one of the regions where SES can receive mail.

## Deploy

```bash
make login       # browser sign-in for the fraud-hero profile
make bootstrap   # once per account and region
make deploy
```

The deploy prints the stack outputs: `BucketName`, `QueueUrl`, `DeadLetterQueueUrl`, and three DKIM records (`DkimRecord1Name` / `DkimRecord1Value` … `3`). The raw `aws` commands below assume the profile is set:

```bash
export AWS_PROFILE=fraud-hero
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

3. Activate ours. This is a one-time step that CDK can't do. **The `--rule-set-name` is required**: the same command without it *deactivates* receiving.

   ```bash
   aws ses set-active-receipt-rule-set --rule-set-name fraud-hero --region us-east-1
   ```

## Watching the pipeline

Load the names once per shell:

```bash
output() { aws cloudformation describe-stacks --stack-name FraudHero --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET=$(output BucketName); QUEUE=$(output QueueUrl); DLQ=$(output DeadLetterQueueUrl)
LOGS=$(aws logs describe-log-groups --region us-east-1 --log-group-name-prefix FraudHero-HeroLambdaLogs \
  --query "logGroups[0].logGroupName" --output text)
```

**Mail landing in S3:** each object is the full raw email. The `X-SES-Spam-Verdict` / `X-SES-Virus-Verdict` headers show SES's scan results. Mail to other addresses on the subdomain isn't stored, and stored mail is deleted after 30 days.

```bash
aws s3 ls "s3://$BUCKET/inbound/" --region us-east-1
aws s3 cp "s3://$BUCKET/inbound/<object-key>" - --region us-east-1 | head -40   # raw message
```

**hero_lambda logs:** one `{"event": "received", "bucket": ..., "key": ...}` line per email.

```bash
aws logs tail "$LOGS" --region us-east-1 --follow
```

**Queue and dead-letter queue depth:**

```bash
for q in "$QUEUE" "$DLQ"; do aws sqs get-queue-attributes --queue-url "$q" --region us-east-1 \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --output text; done
```

**Testing the dead-letter queue:** send a message that isn't an S3 event. `hero_lambda` fails on it 3 times (one attempt every ~3 minutes), then it appears in the DLQ. Purge it afterwards.

```bash
aws sqs send-message --queue-url "$QUEUE" --message-body "not an s3 event" --region us-east-1
aws sqs purge-queue --queue-url "$DLQ" --region us-east-1
```

## Rollback

```bash
aws ses set-active-receipt-rule-set --region us-east-1   # no name = deactivate receiving
cd infra && npx cdk destroy
```

Then remove the DNS records in Vercel. The bucket is kept on purpose so mail is never deleted by accident. Empty and delete it in the S3 console if you really want it gone.
