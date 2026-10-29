// Package storage owns Capital Tracker's SQLite database, schema migrations,
// account activity periods, monthly balances, groups, and portable snapshots.
// Mutations are serialized and use transactions to preserve financial history.
package storage
