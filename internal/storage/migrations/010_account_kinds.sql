-- An account is an asset, a debt the household owes, or money owed to it.
-- Balances stay signed contributions to net worth: a debt is stored negative.
-- The kind is current, like group membership: it never changes saved totals.
ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'asset' CHECK(kind IN ('asset','liability','receivable'));
