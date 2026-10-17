# Proposal

## Why

Received emails now land in S3, but nothing knows they arrived. Before anything reads or judges an email, we need a reliable way to hand each one to a processor: every stored email triggers work exactly once, failures are retried, and anything that keeps failing is kept rather than lost. This change builds that hand-off with a processor that only logs, so the plumbing can be proven on its own.

## What Changes

- Each new object under `inbound/` sends an event to an SQS queue.
- A dead-letter queue (DLQ) keeps any message that fails processing 3 times.
- A new Python Lambda consumes the queue one message at a time and logs which email arrived (bucket and key only). It never reads the email itself.
- The Lambda ignores SES's `AMAZON_SES_SETUP_NOTIFICATION` object and S3's notification test event, and treats any message it can't understand as a failure, so it's retried and then moved to the DLQ.
- A new `hero_lambda/` Python project (standard library only, tests with `pytest`), which later steps build on.
- README updated with how to watch the queue, the DLQ and the Lambda logs, using the existing `Makefile` targets and the `fraud-hero` profile.

Still not in this change: the sender allowlist, reading email content, any model call, and replies. `hero_lambda` stays a pass-through until the full flow (model verdict, then reply) works end to end. **The sender allowlist is the final phase.** Until it ships, SES stays in sandbox mode so replies can't reach strangers, and the model-call phase adds cost limits.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `email-intake`: adds requirements for handing each stored email to processing (one queue message per email, retries, dead-lettering, ignoring setup notifications, logging without content). Existing requirements are unchanged.

## Impact

- **Code:** `infra/lib/fraud-hero-stack.ts` (queue, DLQ, notification, Lambda), new `hero_lambda/` (handler and tests), README, and a `Makefile` target for the Python tests.
- **AWS resources:** two SQS queues, one Lambda with its log group, and the S3 → SQS notification. CDK implements bucket notifications with a small helper Lambda that it creates and manages, so the stack now has assets, which deploy through the existing bootstrap.
- **Permissions:** the Lambda can only consume its queue and write its own logs. It gets no access to the bucket yet.
- **Cost:** negligible at a few emails a week.
