# Tasks

## 1. Lambda Project

- [x] 1.1 Create `hero_lambda/` with `pyproject.toml` (dev dependency `pytest`, `requires-python >= 3.12`), an empty `handler.py`, `tests/`, and `.gitignore` for `.venv/`, `__pycache__/` and `.pytest_cache/`. Verify `uv run pytest` runs (no tests yet).

## 2. Processor

- [x] 2.1 Implement `handler.handler(event, context)`: parse each SQS record body as an S3 notification, skip `s3:TestEvent` and `inbound/AMAZON_SES_SETUP_NOTIFICATION`, URL-decode the key, print one JSON line `{"event": "received", "bucket": ..., "key": ...}` per email, and raise on any body that isn't a valid S3 notification. Verify with `pytest` tests covering a normal email, an encoded key, the setup notification, the test event, invalid JSON, a missing `Records` field in a non-test event, and that no AWS client is created.

## 3. Infrastructure

- [x] 3.1 Add the DLQ (14-day retention) and the inbound queue (visibility 180s, DLQ after 3 receives, SQS-managed encryption), plus the S3 → SQS notification for `ObjectCreated` under `inbound/`. Verify with CDK assertion tests for the redrive policy, visibility timeout, retention, and the notification's event and prefix filter.
- [x] 3.2 Add the Python 3.13 Lambda from `hero_lambda/` (excluding tests and tooling), with 30s timeout, an explicit log group with 1-month retention, and an SQS event source with batch size 1. Verify with assertion tests for runtime, handler, timeout, batch size, log retention, and that the Lambda's role has no S3 permissions. Also add `QueueUrl` and `DeadLetterQueueUrl` stack outputs.

## 4. Documentation and Tooling

- [x] 4.1 Add a `test-hero-lambda` target to the `Makefile` (and have `test` run both suites), and update `README.md`: the pipeline diagram, `make` targets as the primary commands, how to tail the Lambda logs, check queue and DLQ depth, send a junk message to test the DLQ, and purge the DLQ. Verify `make test` passes and the local commands run as written.

## 5. Live Check

- [x] 5.1 `make deploy`, then send an email to the service address and confirm exactly one `received` log line with its key. Send a junk message to the queue and confirm it lands in the DLQ after 3 attempts, then purge the DLQ.
