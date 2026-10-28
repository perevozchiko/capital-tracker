package storage

import (
	"database/sql"
	"strconv"
	"strings"

	"github.com/perevozchiko/capital-tracker/internal/finance"
)

// AccountGroup groups current accounts. Moving an account never rewrites its
// saved balances or changes the overall monthly capital.
type AccountGroup struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	SortOrder int64  `json:"sort_order"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type GroupTotal struct {
	TotalEURMinor *string `json:"total_eur_minor"`
	Complete      bool    `json:"complete"`
}

type GroupWithTotal struct {
	AccountGroup
	GroupTotal
}

type GroupsForMonth struct {
	Groups    []GroupWithTotal `json:"groups"`
	Ungrouped GroupTotal       `json:"ungrouped"`
	Month     string           `json:"month"`
}

type AccountAssignment struct {
	ID      int64  `json:"id"`
	GroupID *int64 `json:"group_id"`
}

func validGroupName(name string) bool {
	return name != "" && strings.TrimSpace(name) == name && len([]rune(name)) <= 100
}

func (s *Store) Groups() ([]AccountGroup, error) {
	rows, err := s.DB.Query("SELECT id,name,sort_order,created_at,updated_at FROM account_groups ORDER BY sort_order,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []AccountGroup{}
	for rows.Next() {
		var g AccountGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.SortOrder, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func (s *Store) CreateGroup(name string) (AccountGroup, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	name = strings.TrimSpace(name)
	if !validGroupName(name) {
		return AccountGroup{}, invalid("name")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return AccountGroup{}, err
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRow("SELECT COUNT(*) FROM account_groups WHERE name=? COLLATE NOCASE", name).Scan(&exists); err != nil {
		return AccountGroup{}, err
	}
	if exists > 0 {
		return AccountGroup{}, conflict("group_name_exists")
	}
	var order int64
	if err = tx.QueryRow("SELECT COALESCE(MAX(sort_order),0)+1 FROM account_groups").Scan(&order); err != nil {
		return AccountGroup{}, err
	}
	stamp := now()
	result, err := tx.Exec("INSERT INTO account_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)", name, order, stamp, stamp)
	if err != nil {
		return AccountGroup{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return AccountGroup{}, err
	}
	if err = tx.Commit(); err != nil {
		return AccountGroup{}, err
	}
	return AccountGroup{ID: id, Name: name, SortOrder: order, CreatedAt: stamp, UpdatedAt: stamp}, nil
}

func (s *Store) RenameGroup(id int64, name string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	name = strings.TrimSpace(name)
	if !validGroupName(name) {
		return invalid("name")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists int
	if err = tx.QueryRow("SELECT COUNT(*) FROM account_groups WHERE name=? COLLATE NOCASE AND id<>?", name, id).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return conflict("group_name_exists")
	}
	result, err := tx.Exec("UPDATE account_groups SET name=?,updated_at=? WHERE id=?", name, now(), id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// DeleteGroup only removes the container. ON DELETE SET NULL retains accounts
// and all financial history, placing the accounts in the Ungrouped section.
func (s *Store) DeleteGroup(id int64) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	result, err := s.DB.Exec("DELETE FROM account_groups WHERE id=?", id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ReorderGroups(ids []int64) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query("SELECT id FROM account_groups")
	if err != nil {
		return err
	}
	existing := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		existing[id] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(ids) != len(existing) {
		return invalid("ids")
	}
	seen := map[int64]bool{}
	for i, id := range ids {
		if !existing[id] || seen[id] {
			return invalid("ids")
		}
		seen[id] = true
		if _, err = tx.Exec("UPDATE account_groups SET sort_order=?,updated_at=? WHERE id=?", i+1, now(), id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AssignAccounts atomically sets membership AND order for every account.
// This prevents split drag-and-drop writes from leaving half-moved accounts.
func (s *Store) AssignAccounts(items []AccountAssignment) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	groups := map[int64]bool{}
	rows, err := tx.Query("SELECT id FROM account_groups")
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		groups[id] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	accounts := map[int64]bool{}
	rows, err = tx.Query("SELECT id FROM accounts")
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		accounts[id] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(items) != len(accounts) {
		return invalid("ids")
	}
	seen := map[int64]bool{}
	for i, item := range items {
		if !accounts[item.ID] || seen[item.ID] || (item.GroupID != nil && !groups[*item.GroupID]) {
			return invalid("ids")
		}
		seen[item.ID] = true
		if _, err = tx.Exec("UPDATE accounts SET group_id=?,sort_order=?,updated_at=? WHERE id=?", item.GroupID, i+1, now(), item.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GroupsAt uses the same exact conversion and rounding as the month total.
// An incomplete group does not masquerade as a zero balance.
func (s *Store) GroupsAt(month string) (GroupsForMonth, error) {
	out := GroupsForMonth{Groups: []GroupWithTotal{}, Month: month}
	if !finance.ValidMonth(month) {
		return out, invalid("month")
	}
	groups, err := s.Groups()
	if err != nil {
		return out, err
	}
	data, err := s.Month(month)
	if err != nil {
		return out, err
	}
	byGroup := map[int64][]finance.Entry{}
	activeCount := map[int64]int{}
	complete := map[int64]bool{}
	for _, g := range groups {
		complete[g.ID] = true
	}
	complete[0] = true
	balances := map[int64]string{}
	for _, b := range data.Balances {
		balances[b.AccountID] = b.AmountMinor
	}
	rates := map[string]int64{"EUR": finance.RateScale}
	for _, r := range data.Rates {
		rate, e := finance.ParseRate(r.Rate)
		if e != nil {
			return out, e
		}
		rates[r.Currency] = rate
	}
	for _, a := range data.Accounts {
		gid := int64(0)
		if a.GroupID != nil {
			gid = *a.GroupID
		}
		activeCount[gid]++
		b, ok := balances[a.ID]
		rate := rates[a.Currency]
		if !ok || rate == 0 {
			complete[gid] = false
			continue
		}
		value, err := strconv.ParseInt(b, 10, 64)
		if err != nil {
			return out, err
		}
		byGroup[gid] = append(byGroup[gid], finance.Entry{Amount: value, Rate: rate})
	}
	total := func(id int64) (GroupTotal, error) {
		if !data.Exists || activeCount[id] == 0 || !complete[id] {
			return GroupTotal{}, nil
		}
		result, err := finance.TotalEURMinor(byGroup[id])
		if err != nil {
			return GroupTotal{}, invalidReason("total_eur_minor", "total_overflow")
		}
		str := strconv.FormatInt(result, 10)
		return GroupTotal{TotalEURMinor: &str, Complete: true}, nil
	}
	for _, g := range groups {
		result, err := total(g.ID)
		if err != nil {
			return out, err
		}
		out.Groups = append(out.Groups, GroupWithTotal{AccountGroup: g, GroupTotal: result})
	}
	out.Ungrouped, err = total(0)
	return out, err
}

// validateGroupID is called inside the transaction that creates an account.
func validateGroupID(tx *sql.Tx, groupID *int64) error {
	if groupID == nil {
		return nil
	}
	if *groupID <= 0 {
		return invalid("group_id")
	}
	var exists int
	err := tx.QueryRow("SELECT COUNT(*) FROM account_groups WHERE id=?", *groupID).Scan(&exists)
	if err != nil {
		return err
	}
	if exists == 0 {
		return invalid("group_id")
	}
	return nil
}
