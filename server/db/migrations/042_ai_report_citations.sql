-- Web results the provider's search actually returned for a report (url + title),
-- kept for auditing which model-cited URLs were accepted or dropped.
ALTER TABLE ai_reports ADD COLUMN citations TEXT NOT NULL DEFAULT '[]';
