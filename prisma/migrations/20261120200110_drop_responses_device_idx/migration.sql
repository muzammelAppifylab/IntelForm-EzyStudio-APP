-- Sorting the Responses table by device no longer has its own index: it reads the newest 50,000
-- responses of the form, like an answer sort, so every submit writes one index less.
-- Dropped CONCURRENTLY, alone (database.md), so submits never wait on it.
DROP INDEX CONCURRENTLY IF EXISTS "responses_form_id_device_id_idx";
