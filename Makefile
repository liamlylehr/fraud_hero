AWS_PROFILE ?= fraud-hero
export AWS_PROFILE

CDK := cd infra && npx cdk

.PHONY: help login whoami install synth diff bootstrap deploy typecheck test

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-12s %s\n", $$1, $$2}'

login: ## Browser sign-in for AWS_PROFILE
	aws login --profile $(AWS_PROFILE)

whoami: ## Show the AWS identity in use
	aws sts get-caller-identity

install: ## Install infra dependencies
	cd infra && npm install

synth: ## Synthesize the CDK app
	$(CDK) synth

diff: ## Diff the stack against what's deployed
	$(CDK) diff

bootstrap: ## One-time CDK bootstrap of the account/region
	$(CDK) bootstrap

deploy: ## Deploy the stack
	$(CDK) deploy

typecheck: ## Type-check infra
	cd infra && npm run typecheck

test: ## Run infra tests
	cd infra && npm test
