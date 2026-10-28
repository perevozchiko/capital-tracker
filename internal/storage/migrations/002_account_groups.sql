CREATE TABLE account_groups (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) > 0),
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
ALTER TABLE accounts ADD COLUMN group_id INTEGER REFERENCES account_groups(id) ON DELETE SET NULL;
CREATE INDEX ix_accounts_group ON accounts(group_id,sort_order,id);
