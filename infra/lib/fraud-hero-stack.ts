import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import type { Construct } from "constructs";

import type { InboundConfig } from "./config.ts";

export const INBOUND_PREFIX = "inbound/";
export const RULE_SET_NAME = "fraud-hero";

export class FraudHeroStack extends Stack {
  readonly bucket: s3.Bucket;

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

    new CfnOutput(this, "BucketName", { value: this.bucket.bucketName });
    identity.dkimRecords.forEach((record, i) => {
      new CfnOutput(this, `DkimRecord${i + 1}Name`, { value: record.name });
      new CfnOutput(this, `DkimRecord${i + 1}Value`, { value: record.value });
    });
  }
}
