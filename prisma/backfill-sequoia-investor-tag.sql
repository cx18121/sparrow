-- Add investor:sequoia tag to all companies ingested from the Sequoia source
-- that don't already have it.
UPDATE "Company"
SET tags = array_append(tags, 'investor:sequoia')
WHERE source = 'sequoia'
  AND NOT ('investor:sequoia' = ANY(tags));
