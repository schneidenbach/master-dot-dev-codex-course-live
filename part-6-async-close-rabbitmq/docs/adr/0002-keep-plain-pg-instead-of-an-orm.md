# Keep plain `pg` instead of replacing SQL with an ORM

Part 6 will keep its explicit PostgreSQL queries and migrations rather than replace them with
an ORM. The current queries bind every request-derived value as a parameter, while Zod checks
API inputs and PostgreSQL constraints protect stored invariants; an ORM would therefore add
little protection against the risks present here and would still require database-specific SQL
for row locks, `SKIP LOCKED` worker batches, lateral reads, partial indexes, and the transactional
outbox. The main remaining safety gap is not the lack of an ORM: `pg` row-type parameters are
unchecked TypeScript assertions and can drift from query results.

## Considered options

- **Replace `pg` with an ORM.** Rejected because the migration cost and additional abstraction
  do not remove the need to understand or test the PostgreSQL concurrency and delivery semantics
  on which bidding and auction closing depend.
- **Keep handwritten SQL with the current safeguards.** Accepted for the application's current
  size and query set. SQL values must remain parameterized, schema changes must remain explicit
  ordered migrations, and integration tests must continue to exercise the real PostgreSQL
  behavior.
- **Add schema-aware SQL checking or generated query types.** Deferred as a targeted improvement
  if query volume or team size makes result-shape drift a recurring problem. This would address
  the identified type-safety gap without hiding the SQL or changing its transaction semantics.

## Consequences

Reviewers must continue checking SQL structure and transaction boundaries directly. Values from
opaque database types such as `jsonb` must be treated as `unknown` and validated at the boundary,
as the outbox publisher already does with `auctionClosedEventSchema`; TypeScript row declarations
alone are not evidence that a database result has the declared shape.
