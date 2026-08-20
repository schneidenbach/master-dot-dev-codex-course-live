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

**Auction deadline**:
The instant at which an auction stops accepting bids, whether or not its close outcome has
yet been recorded.
_Avoid_: Worker close time, notification time

**Auction close**:
The durable outcome recorded after an auction deadline, identifying its winning accepted
bid when one exists.
_Avoid_: Deadline, popup, socket event

**Winning bidder**:
The user who placed the highest accepted bid recorded in an auction close.
_Avoid_: Current viewer, last socket client

**Auction outcome notification**:
A live, dismissible notice that an auction has closed, addressed to its seller and, when
there is a winning bid, its winning bidder.
_Avoid_: Winner notification, auction update
