# Spec Delta

## ADDED Requirements

### Requirement: Each stored email is handed to processing
The system SHALL deliver one processing event for every email stored under `inbound/`. Objects stored elsewhere in the bucket SHALL NOT trigger processing.

#### Scenario: Email arrives
- **WHEN** an email is stored under `inbound/`
- **THEN** the processor receives an event naming that email's bucket and key

#### Scenario: Object outside inbound/
- **WHEN** an object is written to the bucket outside `inbound/`
- **THEN** no processing event is created

### Requirement: Processing failures are retried, then kept
The system SHALL retry an event whose processing fails, and SHALL move it to a dead-letter queue after 3 failed attempts, where it is kept for 14 days.

#### Scenario: Processor fails repeatedly
- **WHEN** processing an event fails on every attempt
- **THEN** the event is attempted 3 times and then appears in the dead-letter queue

#### Scenario: Unreadable event
- **WHEN** the processor receives a message that isn't a valid storage event
- **THEN** processing fails, so the message is retried and then dead-lettered rather than silently dropped

### Requirement: Non-email notifications are ignored
The processor SHALL ignore the receiving service's setup notification object and the storage service's notification test event, completing without error and without logging them as received email.

#### Scenario: SES setup notification
- **WHEN** the event names the object `inbound/AMAZON_SES_SETUP_NOTIFICATION`
- **THEN** processing completes successfully and no "received" entry is logged

#### Scenario: Storage test event
- **WHEN** the processor receives the test event sent when the notification is configured
- **THEN** processing completes successfully and nothing is logged as received

### Requirement: Arrivals are logged without content
For each received email, the processor SHALL write one structured log entry containing the bucket and object key, and SHALL NOT read or log the email's content.

#### Scenario: Email is logged
- **WHEN** the processor handles an event for `inbound/abc123`
- **THEN** exactly one log entry records `received` with that bucket and key

#### Scenario: Content is never read
- **WHEN** the processor handles any event
- **THEN** it makes no request to read the stored email
