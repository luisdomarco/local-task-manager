# Overview

Acme Web is a server-rendered shop in front of three services.

| Service | Owns | Talks to |
|---|---|---|
| Catalogue API | products, prices, stock | search index |
| Cart service | carts, coupons | Payments API |
| Payments API | charges, refunds | Stripe |

## Decisions in force

- **Carts live in the cart service**, never in the session: a failed payment keeps the cart (SPEC-7).
- **Every payment call carries an idempotency key** since the double-charge incident (LRN after SUP-2).
- **Search is a separate index**, rebuilt nightly and patched on every product change.
