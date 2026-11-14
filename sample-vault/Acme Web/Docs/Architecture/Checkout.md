# Checkout

How an order is paid, drawn in draw.io (`Checkout flow.drawio`, opened here as its diagram):

![[Checkout flow.drawio]]

## What it rests on

The decisions of [[Overview]] it keeps, embedded from there:

![[Overview#Decisions in force]]

Every charge carries the order's idempotency key[^key]. %%Ask Marta whether refunds do too.%%

```bash
curl -X POST https://payments.example/charges -H "Idempotency-Key: $ORDER_KEY"
```

[^key]: A random id per order, kept for 24 hours: the same call twice charges once.
