package storage

import "errors"

var (
	ErrValidation = errors.New("validation_error")
	ErrConflict   = errors.New("conflict")
	ErrNotFound   = errors.New("not_found")
)

// DomainError carries stable machine-readable information independent of wording.
type DomainError struct {
	Kind   error
	Reason string
	Field  string
}

func (e *DomainError) Error() string {
	if e.Reason != "" {
		return e.Kind.Error() + ": " + e.Reason
	}
	if e.Field != "" {
		return e.Kind.Error() + ": " + e.Field
	}
	return e.Kind.Error()
}

func (e *DomainError) Unwrap() error { return e.Kind }

func invalid(field string) error {
	return &DomainError{Kind: ErrValidation, Field: field}
}

func invalidReason(field, reason string) error {
	return &DomainError{Kind: ErrValidation, Field: field, Reason: reason}
}

func conflict(reason string) error {
	return &DomainError{Kind: ErrConflict, Reason: reason}
}
