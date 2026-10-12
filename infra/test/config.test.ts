import assert from "node:assert/strict";
import { test } from "node:test";

import { readConfig } from "../lib/config.ts";

const from = (values: Record<string, string>) => (key: string) => values[key];

test("valid config is returned normalized", () => {
  assert.deepEqual(readConfig(from({ inboundSubdomain: " Fraud.Example.com ", inboundAddress: "Check@fraud.example.com" })), {
    inboundSubdomain: "fraud.example.com",
    inboundAddress: "check@fraud.example.com",
  });
});

test("missing subdomain is named in the error", () => {
  assert.throws(() => readConfig(from({ inboundAddress: "check@fraud.example.com" })), /inboundSubdomain/);
});

test("missing address is named in the error", () => {
  assert.throws(() => readConfig(from({ inboundSubdomain: "fraud.example.com" })), /inboundAddress/);
});

test("address on a different domain is rejected", () => {
  assert.throws(
    () => readConfig(from({ inboundSubdomain: "fraud.example.com", inboundAddress: "check@other.com" })),
    /must be on "inboundSubdomain"/,
  );
});

test("address on the parent domain is rejected", () => {
  assert.throws(() => readConfig(from({ inboundSubdomain: "fraud.example.com", inboundAddress: "check@example.com" })));
});
