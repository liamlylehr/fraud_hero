# Spec Delta

## Purpose

Receives emails forwarded to the service's address and keeps them, unchanged and private, so that later steps can check and analyze them.

## ADDED Requirements

### Requirement: Mail to the service address is stored unchanged
The system SHALL store every email delivered to the configured service address as the complete raw message, under the `inbound/` prefix of a dedicated storage bucket.

#### Scenario: Forwarded email lands in storage
- **WHEN** an email is sent to the configured service address
- **THEN** a new object containing the full raw message appears under `inbound/`

#### Scenario: Stored message is complete
- **WHEN** a stored object is downloaded
- **THEN** it contains the original headers and body, including any forwarded content and attachments

### Requirement: Only the service address is accepted
The system SHALL store mail only for the configured service address. Mail sent to any other address on the subdomain SHALL NOT be stored.

#### Scenario: Mail to another address on the subdomain
- **WHEN** an email is sent to a different address on the same subdomain
- **THEN** no object is stored for it

### Requirement: Stored mail carries spam and virus verdicts
The system SHALL scan incoming mail for spam and viruses and record the results in the stored message's headers, so later steps can act on them.

#### Scenario: Scan results recorded
- **WHEN** an email is stored
- **THEN** its stored headers include the receiving service's spam and virus verdicts

### Requirement: Stored mail is private
Stored emails SHALL NOT be publicly accessible, SHALL be encrypted at rest, and SHALL only be readable over encrypted connections.

#### Scenario: Anonymous access is denied
- **WHEN** an unauthenticated request tries to read a stored email
- **THEN** the request is denied

### Requirement: Stored mail expires
The system SHALL delete emails stored under `inbound/` 30 days after they arrive.

#### Scenario: Old mail is removed
- **WHEN** an email has been stored for more than 30 days
- **THEN** it is deleted automatically

### Requirement: Service address is configured, not hardcoded
The subdomain and service address SHALL come from deployment configuration. Deployment SHALL fail with a clear error when either is missing, or when the address is not on the configured subdomain.

#### Scenario: Missing configuration
- **WHEN** a deployment is attempted without a subdomain or service address configured
- **THEN** it fails before creating any resources, naming the missing setting

#### Scenario: Address on a different domain
- **WHEN** the configured address is `check@other.com` but the subdomain is `fraud.example.com`
- **THEN** deployment fails with an error explaining the mismatch
