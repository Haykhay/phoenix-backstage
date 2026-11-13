# catalog-backend-module-aws-accounts

A Backstage catalog backend module that reads the **DynamoDB account registry**
(Phoenix Layer 0) and projects each item into an `aws-account` Resource entity —
the same shape `phoenix/accounts.yaml` carried by hand, now served live.

DynamoDB is the durable source of truth, so a Backstage rebuild re-syncs from it.

## Config

```yaml
phoenix:
  registry:
    tableName: phoenix-account-registry
    region: eu-west-1
    # endpoint: http://localhost:4566   # local Floci; omit for real AWS
```

## Wiring

```ts
backend.add(import('@internal/plugin-catalog-backend-module-aws-accounts'));
```

## Testing

`projectItem` (registry item → entity) is a pure function unit-tested without
the Backstage build:

```bash
node --experimental-strip-types --test src/projectItem.test.ts
```

The provider's DynamoDB read path uses an injectable client and is exercised by
`backstage-cli package test` once dependencies are installed, and end-to-end
against a local Floci (`phoenix.registry.endpoint`).
