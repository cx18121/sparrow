ALTER TABLE "Template"
  ALTER COLUMN "verbatim" SET DEFAULT true;

UPDATE "Template"
  SET "verbatim" = true
  WHERE "verbatim" = false;
