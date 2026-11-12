-- Major expense groups belong to one month, like recurring-expense groups.
-- Membership follows the month's entry positions and is replaced on save.
CREATE TABLE expense_groups (
    month TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position >= 0),
    name TEXT NOT NULL,
    PRIMARY KEY(month, position)
);
CREATE TABLE expense_group_members (
    month TEXT NOT NULL,
    entry_position INTEGER NOT NULL,
    group_position INTEGER NOT NULL,
    sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
    PRIMARY KEY(month, entry_position),
    FOREIGN KEY(month, entry_position) REFERENCES expenses(month, position) ON DELETE CASCADE,
    FOREIGN KEY(month, group_position) REFERENCES expense_groups(month, position) ON DELETE CASCADE
);
