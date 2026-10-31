-- Keep empty monthly snapshots so removing all recurring expenses stops inheritance.
CREATE TABLE recurring_expense_months (month TEXT PRIMARY KEY);
CREATE TABLE recurring_expenses (
    month TEXT NOT NULL REFERENCES recurring_expense_months(month) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
    rate_scaled INTEGER NOT NULL CHECK(rate_scaled > 0),
    PRIMARY KEY(month, position)
);
