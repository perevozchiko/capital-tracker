-- Groups belong to a monthly snapshot and inherit together with its expenses.
CREATE TABLE recurring_expense_groups (
    month TEXT NOT NULL REFERENCES recurring_expense_months(month) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    name TEXT NOT NULL,
    PRIMARY KEY(month, position)
);
CREATE TABLE recurring_expense_group_members (
    month TEXT NOT NULL,
    entry_position INTEGER NOT NULL,
    group_position INTEGER NOT NULL,
    sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
    PRIMARY KEY(month, entry_position),
    FOREIGN KEY(month, entry_position) REFERENCES recurring_expenses(month, position) ON DELETE CASCADE,
    FOREIGN KEY(month, group_position) REFERENCES recurring_expense_groups(month, position) ON DELETE CASCADE
);
