"""Consumes the inbound queue: one S3 notification per message, one log line per received email.

For now this only proves the hand-off works. It never reads the email itself.
"""

import json
from urllib.parse import unquote_plus

# SES writes this object when the receipt rule is created, to prove it can reach the bucket.
SES_SETUP_KEY = "inbound/AMAZON_SES_SETUP_NOTIFICATION"


def handler(event, context):
    for record in event["Records"]:
        for bucket, key in emails_in(record["body"]):
            print(json.dumps({"event": "received", "bucket": bucket, "key": key}))


def emails_in(body: str) -> list[tuple[str, str]]:
    """Return (bucket, key) for each email in an S3 notification.

    Anything that isn't a valid notification raises, so SQS retries it and then
    moves it to the dead-letter queue instead of it being silently dropped.
    """
    notification = json.loads(body)
    # S3 sends this once when the notification is configured; it names no object.
    if notification.get("Event") == "s3:TestEvent":
        return []

    emails = []
    for record in notification["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])  # S3 URL-encodes keys
        if key != SES_SETUP_KEY:
            emails.append((bucket, key))
    return emails
