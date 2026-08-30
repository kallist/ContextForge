# Queue design

`Worker` uses `LeasePolicy` before asking `JobStore` to claim work. Expired running work returns to pending, and API submission remains idempotent by job identifier.
