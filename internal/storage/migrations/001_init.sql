CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL CHECK(length(trim(name)) > 0),
 currency TEXT NOT NULL CHECK(currency IN ('EUR','USD','RSD','RUB','TRY')),
 start_month TEXT NOT NULL CHECK(length(start_month)=7 AND substr(start_month,6,2) BETWEEN '01' AND '12'),
 archived_from_month TEXT CHECK(archived_from_month IS NULL OR (length(archived_from_month)=7 AND substr(archived_from_month,6,2) BETWEEN '01' AND '12')),
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE account_periods (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 start_month TEXT NOT NULL CHECK(length(start_month)=7 AND substr(start_month,6,2) BETWEEN '01' AND '12'),
 end_month TEXT CHECK(end_month IS NULL OR (end_month > start_month AND length(end_month)=7 AND substr(end_month,6,2) BETWEEN '01' AND '12')),
 UNIQUE(account_id,start_month)
);
CREATE INDEX ix_periods_month ON account_periods(start_month,end_month);
CREATE TABLE months (
 month TEXT PRIMARY KEY CHECK(length(month)=7 AND substr(month,6,2) BETWEEN '01' AND '12'),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE monthly_balances (
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 month TEXT NOT NULL REFERENCES months(month) ON DELETE CASCADE,
 amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN -9000000000000000 AND 9000000000000000),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(account_id,month)
);
CREATE INDEX ix_balances_month ON monthly_balances(month);
CREATE TABLE exchange_rates (
 month TEXT NOT NULL REFERENCES months(month) ON DELETE CASCADE,
 currency TEXT NOT NULL CHECK(currency IN ('USD','RSD','RUB','TRY')),
 rate_scaled INTEGER NOT NULL CHECK(rate_scaled > 0 AND rate_scaled <= 10000000000000000),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(month,currency)
);
CREATE TABLE app_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
INSERT INTO app_settings(key,value) VALUES ('language','en'),('theme','dark');
PRAGMA application_id = 1128354379;
