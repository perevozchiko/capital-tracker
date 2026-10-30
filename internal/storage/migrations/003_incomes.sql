-- Income notes are independent of account snapshots and their exchange rates.
CREATE TABLE incomes (
    month TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
    rate_scaled INTEGER NOT NULL CHECK(rate_scaled > 0),
    PRIMARY KEY(month, currency)
);
