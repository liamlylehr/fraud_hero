import json
import sys

import pytest

import handler

BUCKET = "fraudhero-inbound-test"


def s3_body(*keys: str) -> str:
    """An S3 ObjectCreated notification, as SQS delivers it in the message body."""
    return json.dumps(
        {"Records": [{"eventName": "ObjectCreated:Put", "s3": {"bucket": {"name": BUCKET}, "object": {"key": k}}} for k in keys]}
    )


def sqs_event(*bodies: str) -> dict:
    return {"Records": [{"messageId": str(i), "body": body} for i, body in enumerate(bodies)]}


def logged(capsys) -> list[dict]:
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


def test_received_email_is_logged_with_bucket_and_key(capsys):
    handler.handler(sqs_event(s3_body("inbound/abc123")), None)
    assert logged(capsys) == [{"event": "received", "bucket": BUCKET, "key": "inbound/abc123"}]


def test_encoded_key_is_decoded(capsys):
    handler.handler(sqs_event(s3_body("inbound/test+mail%281%29.eml")), None)
    assert logged(capsys)[0]["key"] == "inbound/test mail(1).eml"


def test_ses_setup_notification_is_ignored(capsys):
    handler.handler(sqs_event(s3_body("inbound/AMAZON_SES_SETUP_NOTIFICATION")), None)
    assert logged(capsys) == []


def test_s3_test_event_is_ignored(capsys):
    body = json.dumps({"Service": "Amazon S3", "Event": "s3:TestEvent", "Bucket": BUCKET})
    handler.handler(sqs_event(body), None)
    assert logged(capsys) == []


def test_invalid_json_raises_so_sqs_retries():
    with pytest.raises(json.JSONDecodeError):
        handler.handler(sqs_event("not json"), None)


def test_notification_without_records_raises():
    with pytest.raises(KeyError):
        handler.handler(sqs_event(json.dumps({"Event": "something-else"})), None)


def test_no_aws_client_is_created():
    # The processor must never read the stored email; it doesn't even import an AWS SDK.
    handler.handler(sqs_event(s3_body("inbound/abc123")), None)
    assert "boto3" not in sys.modules and "botocore" not in sys.modules
