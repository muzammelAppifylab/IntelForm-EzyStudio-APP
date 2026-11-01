-- The Front page editor is gone: the public site's pages and copy are code now (src/pages/public).
-- What stays editable moves to Settings → Public site: search and sharing (key `site`) and the
-- Privacy and Terms texts (key `legal`). Values of an unexpected type fall back to the defaults.

INSERT INTO app_settings (key, value)
SELECT 'site', jsonb_build_object(
  'indexing', CASE WHEN jsonb_typeof(value->'seo'->'indexing') = 'boolean' THEN (value->'seo'->'indexing')::boolean ELSE false END,
  'description', CASE WHEN jsonb_typeof(value->'seo'->'description') = 'string' THEN value->'seo'->>'description' ELSE '' END,
  'ogImage', CASE WHEN jsonb_typeof(value->'seo'->'ogImage') = 'string' THEN value->'seo'->'ogImage' ELSE 'null'::jsonb END
)
FROM app_settings WHERE key = 'front_page'
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
SELECT 'legal', jsonb_build_object(
  'privacy', CASE WHEN jsonb_typeof(value->'privacy') = 'string' THEN value->>'privacy' ELSE '' END,
  'terms', CASE WHEN jsonb_typeof(value->'terms') = 'string' THEN value->>'terms' ELSE '' END
)
FROM app_settings WHERE key = 'front_page'
ON CONFLICT (key) DO NOTHING;

DELETE FROM app_settings WHERE key = 'front_page';
