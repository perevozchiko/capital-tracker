-- Allow multiple named income notes in the same currency, preserving old totals.
ALTER TABLE incomes RENAME TO incomes_legacy;
CREATE TABLE incomes (
    month TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
    rate_scaled INTEGER NOT NULL CHECK(rate_scaled > 0),
    PRIMARY KEY(month, position)
);
INSERT INTO incomes(month,position,name,currency,amount_minor,rate_scaled)
SELECT month, ROW_NUMBER() OVER (PARTITION BY month ORDER BY currency) - 1,
       'Income · ' || currency, currency, amount_minor, rate_scaled
FROM incomes_legacy;
DROP TABLE incomes_legacy;
