# Design

## Context

The `email-intake` stack already receives mail with SES and stores it in S3 under `inbound/` (`infra/lib/fraud-hero-stack.ts`, with assertion tests in `infra/test/stack.test.ts`). There's no Python code yet. Deploys run through the root `Makefile` with `AWS_PROFILE=fraud-hero`. See `proposal.md` for the motivation and `specs/email-intake/spec.md` for the new behavior.

## Goals / Non-Goals

**Goals:**
- Prove the S3 → SQS → Lambda path, including retries and the DLQ, with the smallest possible processor.
- Set up the `hero_lambda/` project the next changes build on.

**Non-Goals:**
- Reading, parsing or judging email (the next changes).
- Any sender filtering. The allowlist comes next, before content is read.
- Alarms or dashboards. Watching the DLQ is manual for now.

## Architecture

```
 S3 bucket --(ObjectCreated, prefix inbound/)--> SQS "Inbound" (SSE, visibility 180s)
                                                     |          \
                                                     |           \ after 3 failed receives
                                                     v            v
                                          Lambda "HeroLambda"    SQS "DeadLetters" (14 days)
                                          python3.13, batch 1
                                          logs {"event":"received","bucket","key"}
```

## Decisions

### SQS between S3 and the Lambda
This gives retries and a DLQ without custom code, and a place to see backlog. Invoking Lambda straight from S3 is asynchronous with its own retry rules, and is harder to inspect.

### Batch size 1, maxReceiveCount 3, visibility 6× the Lambda timeout
With one email per invocation, a failure retries exactly that email. 3 receives then DLQ, as in the spec. A Lambda timeout of 30s gives a 180s visibility timeout, following AWS's guidance of 6× the timeout so retries don't overlap. The DLQ keeps messages for 14 days, the SQS maximum.

### Fail loudly on unreadable messages, return quietly on known non-email events
The handler parses each SQS body as an S3 notification. If it can't (bad JSON, missing fields), it raises, so SQS retries and then dead-letters the message. That's also how the live DLQ check works: send a junk message with `aws sqs send-message`. S3's `s3:TestEvent` (no `Records`) and the `AMAZON_SES_SETUP_NOTIFICATION` key are recognized and skipped.

### Keys are URL-decoded
S3 notifications URL-encode object keys (`+` for spaces), so the handler logs `unquote_plus(key)`. SES message IDs never contain those characters, but uploaded test files might.

### The Lambda gets no S3 access
It doesn't need any yet. Granting read access is deliberately left to the change that adds the allowlist, so "can read email" and "checks the sender" arrive together.

### Logging
`print(json.dumps(...))` to stdout, one line per event. CloudWatch stores it as-is and it can be searched with `aws logs filter-log-events`. The log group is created explicitly with 1-month retention, so it doesn't keep logs forever.

### Python project layout
```
hero_lambda/
  handler.py          # the whole processor
  tests/test_handler.py
  pyproject.toml      # dev only: pytest, run with `uv run pytest`
```
The code uses only the standard library, so there's nothing to bundle: CDK ships `hero_lambda/` as-is with `Code.fromAsset`, excluding tests, `.venv` and the tooling files.

### Queue encryption
SQS-managed SSE (the CDK default). S3 can publish to it without any KMS key policy, which a customer-managed key would need.

### CDK notification helper
`bucket.addEventNotification` deploys a small CDK-managed Lambda (a custom resource) to configure the bucket's notifications. That's standard and needs no code from us, but it does mean the stack now uploads an asset during deploy.

### Code style
Same as before: small, flat files, with comments only where the reason isn't obvious.

## Risks / Trade-offs

- **[The notification custom resource replaces the bucket's whole notification config]** → Nothing else configures notifications on this bucket, so there's nothing to lose. Noted for later.
- **[A message in the DLQ goes unnoticed]** → Accepted for now. The README shows how to check it, and an alarm can come with real processing.
- **[Junk-message test leaves an entry in the DLQ]** → Purge it afterwards with `aws sqs purge-queue` (in the README).
- **[Old emails already in `inbound/` won't be queued]** → Notifications only cover new objects. That's fine, since the existing test email was only a test.

## Migration Plan

`make deploy`, then send a test email. Rollback: `make deploy` from the previous commit removes the queue, the Lambda and the notification. Stored mail is untouched.

## Open Questions

None.
