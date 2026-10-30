-- Major expense notes have their own monthly entries and exchange rates.
CREATE TABLE expenses (
    month TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
    rate_scaled INTEGER NOT NULL CHECK(rate_scaled > 0),
    PRIMARY KEY(month, position)
);
