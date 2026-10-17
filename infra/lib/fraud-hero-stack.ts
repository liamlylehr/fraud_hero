import path from "node:path";
import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

import type { InboundConfig } from "./config.ts";

export const INBOUND_PREFIX = "inbound/";
export const RULE_SET_NAME = "fraud-hero";
export const PROCESSOR_TIMEOUT = Duration.seconds(30);
const HERO_LAMBDA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "hero_lambda");

export class FraudHeroStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly queue: sqs.Queue;
  readonly deadLetters: sqs.Queue;

  constructor(scope: Construct, id: string, config: InboundConfig, props?: StackProps) {
    super(scope, id, props);

    // Raw received emails. Private, encrypted, and only reachable over TLS.
    this.bucket = new s3.Bucket(this, "Inbound", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Kept on `cdk destroy` so received mail is never deleted as a side effect.
      removalPolicy: RemovalPolicy.RETAIN,
      // Nothing processes mail yet, so cap how long spam and stray mail can sit here.
      lifecycleRules: [{ prefix: INBOUND_PREFIX, expiration: Duration.days(30) }],
    });

    // SES only receives for a domain it has verified. Easy DKIM verifies the subdomain
    // through three CNAME records, which we add by hand in Vercel after deploying.
    const identity = new ses.EmailIdentity(this, "Subdomain", {
      identity: ses.Identity.domain(config.inboundSubdomain),
    });

    // Activating a rule set is account-wide and replaces any other active set, so CDK only
    // creates it; activation is a deliberate manual step (see README).
    new ses.ReceiptRuleSet(this, "RuleSet", {
      receiptRuleSetName: RULE_SET_NAME,
      rules: [
        {
          // The exact address, not the whole subdomain: mail to any other address is dropped.
          recipients: [config.inboundAddress],
          // Adds spam/virus verdict headers to the stored mail for later steps to use.
          scanEnabled: true,
          actions: [new sesActions.S3({ bucket: this.bucket, objectKeyPrefix: INBOUND_PREFIX })],
        },
      ],
    });

    // Every new email under inbound/ becomes one queue message. A message that fails
    // processing 3 times moves to the dead-letter queue instead of being lost.
    this.deadLetters = new sqs.Queue(this, "DeadLetters", { retentionPeriod: Duration.days(14) });
    this.queue = new sqs.Queue(this, "Queue", {
      // AWS guidance: 6x the consumer's timeout, so a retry never overlaps a slow attempt.
      visibilityTimeout: Duration.seconds(PROCESSOR_TIMEOUT.toSeconds() * 6),
      encryption: sqs.QueueEncryption.SQS_MANAGED, // S3 can publish without a KMS key policy
      deadLetterQueue: { queue: this.deadLetters, maxReceiveCount: 3 },
    });
    this.bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SqsDestination(this.queue), {
      prefix: INBOUND_PREFIX,
    });

    // Consumes the queue one email at a time. Standard library only, so the folder ships as-is.
    // It gets no S3 access yet: reading email arrives with the model call.
    const heroLambda = new lambda.Function(this, "HeroLambda", {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(HERO_LAMBDA_DIR, {
        exclude: ["tests", ".venv", ".pytest_cache", "**/__pycache__", "pyproject.toml", "uv.lock", ".gitignore"],
      }),
      timeout: PROCESSOR_TIMEOUT,
      logGroup: new logs.LogGroup(this, "HeroLambdaLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    heroLambda.addEventSource(new SqsEventSource(this.queue, { batchSize: 1 }));

    new CfnOutput(this, "QueueUrl", { value: this.queue.queueUrl });
    new CfnOutput(this, "DeadLetterQueueUrl", { value: this.deadLetters.queueUrl });
    new CfnOutput(this, "BucketName", { value: this.bucket.bucketName });
    identity.dkimRecords.forEach((record, i) => {
      new CfnOutput(this, `DkimRecord${i + 1}Name`, { value: record.name });
      new CfnOutput(this, `DkimRecord${i + 1}Value`, { value: record.value });
    });
  }
}
