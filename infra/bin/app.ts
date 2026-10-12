import { App } from "aws-cdk-lib";
import { readConfig } from "../lib/config.ts";
import { FraudHeroStack } from "../lib/fraud-hero-stack.ts";

const app = new App();
const config = readConfig((key) => app.node.tryGetContext(key));

// SES only receives mail in a few regions; us-east-1 is one of them.
new FraudHeroStack(app, "FraudHero", config, { env: { region: "us-east-1" } });
