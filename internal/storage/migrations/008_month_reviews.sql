-- Saving an empty list explicitly records a reviewed zero month.
CREATE TABLE monthly_reviews (
    section TEXT NOT NULL CHECK(section IN ('incomes','expenses')),
    month TEXT NOT NULL,
    PRIMARY KEY(section,month)
);
INSERT INTO monthly_reviews(section,month) SELECT DISTINCT 'incomes',month FROM incomes;
INSERT INTO monthly_reviews(section,month) SELECT DISTINCT 'expenses',month FROM expenses;
