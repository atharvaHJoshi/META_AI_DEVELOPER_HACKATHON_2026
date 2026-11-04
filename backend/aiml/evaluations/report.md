# MIRAIWERK ticket-intelligence evaluation

Generated: 2026-11-04T07:06:22.802Z  
Mode: **Deterministic demo rules (`miraiwerk-rules-v1`). These are labelled rules, not a model output. No network model was called.**  
Benchmark: **MIRAIWERK ticket-intelligence benchmark** · 40 hand-labelled cases

> **Honesty note.** The benchmark labels describe intended product behaviour, not model output. A high score on deterministic rules shows that the fallback is calibrated to the benchmark; it is not evidence of Gemini or Meta model quality.

## Summary

| Metric | Result |
| --- | ---: |
| Overall weighted score | **99.5%** |
| Ticket-type accuracy | 100.0% |
| Policy-priority accuracy | 97.5% |
| Recommendation accuracy | 100.0% |
| Evidence discipline | 100.0% |
| Proposal completeness | 100.0% |
| Duplicate-probe accuracy (40 cases) | 92.5% |
| Duplicate precision / recall / F1 | 71.4% / 83.3% / 76.9% |
| Cases passing every check | 36 / 40 |
| Average analysis latency | 1.8 ms |

Weights: type 20%, priority 20%, recommendation 30%, evidence discipline 15%, proposal completeness 15%. Duplicate detection is reported separately because 40 cases carry an expected duplicate label, and most of those labels are negatives.

### Duplicate confusion

| | Predicted duplicate | Predicted distinct |
| --- | ---: | ---: |
| Actually duplicate | 5 | 1 |
| Actually distinct | 2 | 32 |

## Ticket-type confusion

| Expected \ Actual | bug | clarification | feature_request | incident | technical_debt |
| --- | ---: | ---: | ---: | ---: | ---: |
| bug | 10 | 0 | 0 | 0 | 0 |
| clarification | 0 | 8 | 0 | 0 | 0 |
| feature_request | 0 | 0 | 8 | 0 | 0 |
| incident | 0 | 0 | 0 | 10 | 0 |
| technical_debt | 0 | 0 | 0 | 0 | 4 |

## Cases

| ID | Ticket | Expected (type · priority · recommendation) | Actual | Duplicate | Evidence | Result |
| --- | --- | --- | --- | :---: | :---: | :---: |
| IN-01 | Customers charged twice after checkout retry | incident · P0 · split | incident · P0 · split | ✓ | ✓ | PASS |
| IN-02 | Payment capture webhook delivered twice after gateway tim… | incident · P0 · split | incident · P0 · split | ✓ | ✓ | PASS |
| IN-03 | Checkout freezes when applying a gift card | incident · P0 · split | incident · P0 · split | ✓ | ✓ | PASS |
| IN-04 | Authentication sessions revoked for all users after deploy | incident · P0 · split | incident · P0 · split | ✓ | ✓ | PASS |
| IN-05 | Order confirmation emails missing after successful payment | incident · P0 · split | incident · P0 · split | ✓ | ✓ | PASS |
| IN-06 | Payment success rate dropped in production | incident · P1 · split | incident · P1 · split | ✓ | ✓ | PASS |
| IN-07 | Authentication token refresh loops after session expiry | incident · P0 · split | incident · P0 · split | ✓ | ✓ | PASS |
| IN-08 | Catalog pages return 500 after CDN configuration change | incident · P0 · split | incident · P0 · split | ✓ | ✓ | PASS |
| IN-09 | Customers charged twice but no logs or transaction refere… | incident · P1 · clarify | incident · P1 · clarify | ✓ | ✓ | PASS |
| IN-10 | Checkout errors increased this morning | incident · P1 · clarify | incident · P1 · clarify | ✓ | ✓ | PASS |
| BUG-01 | Search filters reset when returning from a product page | bug · P2 · accept | bug · P2 · accept | ✓ | ✓ | PASS |
| BUG-02 | Filter chips lose state when navigating back | bug · P2 · accept | bug · P2 · accept | ✗ | ✓ | CHECK |
| BUG-03 | Cart totals wrong after applying a promo code | bug · P1 · accept | bug · P1 · accept | ✓ | ✓ | PASS |
| BUG-04 | Product images fail on category pages | bug · P2 · accept | bug · P2 · accept | ✓ | ✓ | PASS |
| BUG-05 | Order history shows stale delivery status | bug · P2 · accept | bug · P2 · accept | ✓ | ✓ | PASS |
| BUG-06 | Password reset link expires before it can be used | bug · P2 · accept | bug · P2 · accept | ✓ | ✓ | PASS |
| BUG-07 | Mobile menu overlaps the cart icon | bug · P2 · accept | bug · P2 · accept | ✓ | ✓ | PASS |
| BUG-08 | Checkout crashes with more than 50 cart items | bug · P1 · accept | bug · P1 · accept | ✓ | ✓ | PASS |
| BUG-09 | Finance invoice export lists the same charge line twice | bug · P2 · accept | bug · P1 · accept | ✓ | ✓ | CHECK |
| BUG-10 | Saved payment method cannot be selected at checkout | bug · P1 · accept | bug · P1 · accept | ✗ | ✓ | CHECK |
| FEAT-01 | Add saved payment methods for returning customers | feature_request · P1 · defer | feature_request · P1 · defer | ✓ | ✓ | PASS |
| FEAT-02 | Add a wishlist for saved products | feature_request · P2 · defer | feature_request · P2 · defer | ✗ | ✓ | CHECK |
| FEAT-03 | Add dark mode to the storefront | feature_request · P2 · defer | feature_request · P2 · defer | ✓ | ✓ | PASS |
| FEAT-04 | Allow customers to schedule delivery windows | feature_request · P1 · defer | feature_request · P1 · defer | ✓ | ✓ | PASS |
| FEAT-05 | Support Apple Pay at checkout | feature_request · P1 · defer | feature_request · P1 · defer | ✓ | ✓ | PASS |
| FEAT-06 | Add a multilingual checkout flow | feature_request · P1 · defer | feature_request · P1 · defer | ✓ | ✓ | PASS |
| FEAT-07 | Add loyalty points for repeat purchases | feature_request · P2 · defer | feature_request · P2 · defer | ✓ | ✓ | PASS |
| FEAT-08 | Add gift card redemption at checkout | feature_request · P1 · defer | feature_request · P1 · defer | ✓ | ✓ | PASS |
| DEBT-01 | Upgrade React 18 to React 19 | technical_debt · P3 · defer | technical_debt · P3 · defer | ✓ | ✓ | PASS |
| DEBT-02 | Remove deprecated billing SDK | technical_debt · P3 · defer | technical_debt · P3 · defer | ✓ | ✓ | PASS |
| DEBT-03 | Refactor the order state machine | technical_debt · P3 · defer | technical_debt · P3 · defer | ✓ | ✓ | PASS |
| DEBT-04 | Stabilize the flaky integration test suite | technical_debt · P3 · defer | technical_debt · P3 · defer | ✓ | ✓ | PASS |
| CLAR-01 | Something about checkout seems off on some devices | clarification · P1 · clarify | clarification · P1 · clarify | ✓ | ✓ | PASS |
| CLAR-02 | App performance changed in the last release | clarification · P2 · clarify | clarification · P2 · clarify | ✓ | ✓ | PASS |
| CLAR-03 | Customer feedback about checkout experience | clarification · P1 · clarify | clarification · P1 · clarify | ✓ | ✓ | PASS |
| CLAR-04 | Question about invoice numbering | clarification · P2 · clarify | clarification · P2 · clarify | ✓ | ✓ | PASS |
| CLAR-05 | Possible concern about performance in the EU region | clarification · P2 · clarify | clarification · P2 · clarify | ✓ | ✓ | PASS |
| CLAR-06 | Need to discuss the Q1 roadmap | clarification · P2 · clarify | clarification · P2 · clarify | ✓ | ✓ | PASS |
| CLAR-07 | Unclear feedback about cart behaviour | clarification · P2 · clarify | clarification · P2 · clarify | ✓ | ✓ | PASS |
| CLAR-08 | Note from customers about checkout | clarification · P1 · clarify | clarification · P1 · clarify | ✓ | ✓ | PASS |

## Checks that did not match

- **BUG-02 — Filter chips lose state when navigating back** (duplicate)
  - Expected: bug / P2 / accept / duplicate=True
  - Actual: bug / P2 / accept / duplicate=False
  - Why it matters: Near-duplicate wording of BUG-01; should link to the existing ticket.
- **BUG-09 — Finance invoice export lists the same charge line twice** (priority)
  - Expected: bug / P2 / accept / duplicate=True
  - Actual: bug / P1 / accept / duplicate=True
  - Why it matters: Duplicate of the finance invoice-export context ticket, not a payment incident.
- **BUG-10 — Saved payment method cannot be selected at checkout** (duplicate)
  - Expected: bug / P1 / accept / duplicate=False
  - Actual: bug / P1 / accept / duplicate=True
  - Why it matters: Same feature area as the saved-payment-methods request, but a distinct defect.
- **FEAT-02 — Add a wishlist for saved products** (duplicate)
  - Expected: feature_request / P2 / defer / duplicate=False
  - Actual: feature_request / P2 / defer / duplicate=True
  - Why it matters: Unscoped feature request, not tied to a release gate.

## What this benchmark does not prove

- It does not measure whether a model is better than the deterministic fallback.
- It does not validate real-world ticket prevalence. The cases are deliberately weighted toward ambiguous and safety-critical reports.
- It does not test plan-generation quality; use the plan-generation review flow and the RippleMap unit tests for that.
- Duplicate candidates use lexical overlap, not semantic embeddings. Paraphrased duplicates can be missed, and tickets in the same feature area can be flagged as candidates; the UI presents them as advisory links that an approver must confirm.
- A correct label does not make an estimate a commitment. Proposed durations remain planning estimates, and the app marks unknowns rather than inventing capacity or deadlines.
