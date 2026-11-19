-- Sorting the Responses table by device: keyset pages walk (form_id, device, id) instead of sorting
-- the whole form. Built CONCURRENTLY, alone, so it never blocks submits (database.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "responses_form_id_device_id_idx" ON "responses" ("form_id", "device", "id");
