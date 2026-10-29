// Package httpapi serves Capital Tracker's loopback-only HTTP API and embedded
// browser UI. Requests modifying data are subject to same-origin and CSRF
// checks; storage enforces accounting and schema invariants.
package httpapi
