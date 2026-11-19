-- No query uses this expression (contacts search reads the contacts table, contacts_search_trgm);
-- every submit paid for its GIN entries.
DROP INDEX CONCURRENTLY IF EXISTS "responses_contact_search";
