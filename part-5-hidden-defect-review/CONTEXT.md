# Auction House

Auction House is a marketplace where sellers list equipment and bidders compete through
time-bounded auctions.

## Language

**Accepted bid**:
A bid that passed the auction's authoritative price, ownership, and closing rules and was
committed to the auction's history.
_Avoid_: Incoming bid, bid attempt

**Auction watcher**:
A person currently viewing an auction's detail page and receiving its live changes.
_Avoid_: Subscriber, socket client

**Authoritative auction state**:
The committed auction details and accepted bid history against which any transient view is
reconciled.
_Avoid_: Socket state, live state
