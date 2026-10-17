import { test } from "node:test";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { FraudHeroStack } from "../lib/fraud-hero-stack.ts";

const config = { inboundSubdomain: "fraud.example.com", inboundAddress: "check@fraud.example.com" };
const template = Template.fromStack(new FraudHeroStack(new App(), "Test", config));

// --- Storage ---------------------------------------------------------------

test("bucket blocks all public access", () => {
  template.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

test("bucket is encrypted with S3-managed keys", () => {
  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
    },
  });
});

test("bucket denies requests that don't use TLS", () => {
  template.hasResourceProperties("AWS::S3::BucketPolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: "Deny",
          Action: "s3:*",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        }),
      ]),
    },
  });
});

test("bucket is kept when the stack is deleted", () => {
  template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
});

test("mail under inbound/ expires after 30 days", () => {
  template.hasResourceProperties("AWS::S3::Bucket", {
    LifecycleConfiguration: {
      Rules: [{ Prefix: "inbound/", ExpirationInDays: 30, Status: "Enabled" }],
    },
  });
});

// --- SES identity and outputs ----------------------------------------------

test("SES identity verifies the subdomain with Easy DKIM", () => {
  template.hasResourceProperties("AWS::SES::EmailIdentity", {
    EmailIdentity: "fraud.example.com",
    DkimAttributes: Match.absent(), // Easy DKIM is the default; nothing turns it off
  });
});

test("outputs the bucket name and all three DKIM records", () => {
  const outputs = Object.keys(template.findOutputs("*"));
  for (const i of [1, 2, 3]) {
    for (const part of ["Name", "Value"]) {
      if (!outputs.includes(`DkimRecord${i}${part}`)) throw new Error(`missing output DkimRecord${i}${part}`);
    }
  }
  template.hasOutput("BucketName", { Value: { Ref: Match.stringLikeRegexp("^Inbound") } });
});

// --- Receipt rule ----------------------------------------------------------

test("one rule set with one rule", () => {
  template.hasResourceProperties("AWS::SES::ReceiptRuleSet", { RuleSetName: "fraud-hero" });
  template.resourceCountIs("AWS::SES::ReceiptRule", 1);
});

test("rule accepts only the exact service address, scans, and stores under inbound/", () => {
  template.hasResourceProperties("AWS::SES::ReceiptRule", {
    RuleSetName: { Ref: Match.anyValue() },
    Rule: Match.objectLike({
      Enabled: true,
      Recipients: ["check@fraud.example.com"],
      ScanEnabled: true,
      Actions: [{ S3Action: Match.objectLike({ BucketName: { Ref: Match.anyValue() }, ObjectKeyPrefix: "inbound/" }) }],
    }),
  });
});

test("bucket policy lets SES write only under inbound/, only for this account", () => {
  template.hasResourceProperties("AWS::S3::BucketPolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: "Allow",
          Action: "s3:PutObject",
          Principal: { Service: "ses.amazonaws.com" },
          Resource: { "Fn::Join": ["", [Match.anyValue(), "/inbound/*"]] },
          Condition: { StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } } },
        }),
      ]),
    },
  });
});

// --- Queue -----------------------------------------------------------------

test("dead-letter queue keeps failed messages for 14 days", () => {
  template.hasResourceProperties("AWS::SQS::Queue", { MessageRetentionPeriod: 14 * 24 * 3600 });
});

test("inbound queue retries 3 times, then dead-letters", () => {
  template.hasResourceProperties("AWS::SQS::Queue", {
    VisibilityTimeout: 180,
    SqsManagedSseEnabled: true,
    RedrivePolicy: { deadLetterTargetArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^DeadLetters"), "Arn"] }, maxReceiveCount: 3 },
  });
  template.resourceCountIs("AWS::SQS::Queue", 2);
});

test("only new objects under inbound/ notify the queue", () => {
  template.hasResourceProperties("Custom::S3BucketNotifications", {
    NotificationConfiguration: {
      QueueConfigurations: [
        {
          Events: ["s3:ObjectCreated:*"],
          Filter: { Key: { FilterRules: [{ Name: "prefix", Value: "inbound/" }] } },
          QueueArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Queue"), "Arn"] },
        },
      ],
    },
  });
});

test("S3 may send messages to the queue, only from this bucket", () => {
  template.hasResourceProperties("AWS::SQS::QueuePolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: "Allow",
          Principal: { Service: "s3.amazonaws.com" },
          Action: Match.arrayWith(["sqs:SendMessage"]),
          Condition: { ArnLike: { "aws:SourceArn": { "Fn::GetAtt": [Match.stringLikeRegexp("^Inbound"), "Arn"] } } },
        }),
      ]),
    },
  });
});

// --- HeroLambda ------------------------------------------------------------

test("HeroLambda runs the Python handler with a 30s timeout", () => {
  template.hasResourceProperties("AWS::Lambda::Function", {
    Runtime: "python3.13",
    Handler: "handler.handler",
    Timeout: 30,
  });
});

test("HeroLambda reads the queue one message at a time", () => {
  template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
    BatchSize: 1,
    EventSourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^Queue"), "Arn"] },
  });
});

test("HeroLambda logs are kept for 1 month", () => {
  template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
});

test("HeroLambda has no S3 permissions", () => {
  const roleId = Object.keys(template.findResources("AWS::IAM::Role")).find((id) => id.startsWith("HeroLambda"));
  if (!roleId) throw new Error("HeroLambda role not found");
  const actions = Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((policy: any) => JSON.stringify(policy.Properties.Roles).includes(roleId))
    .flatMap((policy: any) => policy.Properties.PolicyDocument.Statement.flatMap((s: any) => [s.Action].flat()));
  if (!actions.some((a) => a.startsWith("sqs:"))) throw new Error("expected queue permissions");
  const s3 = actions.filter((a) => a.startsWith("s3:"));
  if (s3.length) throw new Error(`unexpected S3 permissions: ${s3}`);
});

test("outputs the queue and dead-letter queue URLs", () => {
  template.hasOutput("QueueUrl", { Value: { Ref: Match.stringLikeRegexp("^Queue") } });
  template.hasOutput("DeadLetterQueueUrl", { Value: { Ref: Match.stringLikeRegexp("^DeadLetters") } });
});
