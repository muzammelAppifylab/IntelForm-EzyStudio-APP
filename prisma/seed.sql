-- prisma/seed.sql: made-up sample data. Never for a live database.
-- Where it is loaded: a review copy and a public preview of this site, the staging database
-- when the owner presses "Load sample data" (never their live one), and your own machine with
-- `npm run db:seed`. No users and no roles: people sign up. Safe to run twice, all or nothing.
--
-- IntelForm sample data: six forms built from the built-in templates (four live, one closed,
-- one draft), 44 responses over the last weeks, funnel counts (views and starts) and one
-- saved theme. Every address is @example.com. Contacts are never inserted here: the
-- responses_contact_fill trigger fills the responses' contact_* columns and the contacts table
-- from the answers. Forms have no creator (created_by is nullable).
-- Times are relative to now(), so the dashboard always has recent activity.
-- The answers are what the submit route stores (checked by tests/intelform/seed.test.ts).
BEGIN;

-- Stop when real data is there: IntelForm is already in use.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "forms" WHERE "id" NOT IN ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000f006'))
     OR EXISTS (SELECT 1 FROM "responses" WHERE "form_id" NOT IN ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000f006'))
     OR EXISTS (SELECT 1 FROM "themes" WHERE "id" <> '00000000-0000-4000-8000-0000000000c1') THEN
    RAISE EXCEPTION 'prisma/seed.sql is sample data and IntelForm is already in use. Nothing was changed.';
  END IF;
END $$;

-- Fixed ids and ON CONFLICT DO NOTHING: safe to run twice.

INSERT INTO "forms" ("id", "slug", "title", "status", "draft", "settings", "theme", "has_unpublished", "revision", "created_at", "updated_at") VALUES
  ('00000000-0000-4000-8000-00000000f001', 'contact-us', 'Contact us', 'live', '{"layout":"all_at_once","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_csname","label":"Name","required":true,"type":"name","props":{"split":false}},{"id":"f_csemail","label":"Email","description":"We reply to this address.","required":true,"type":"email","props":{"blockFreeDomains":false}},{"id":"f_cstopic","label":"Topic","required":true,"type":"dropdown","props":{"options":[{"id":"o_cst1","label":"General question"},{"id":"o_cst2","label":"Account or billing"},{"id":"o_cst3","label":"Technical problem"},{"id":"o_cst4","label":"Feedback"},{"id":"o_cst5","label":"Other"}],"searchable":false,"randomize":false}},{"id":"f_csmsg","label":"Message","required":true,"placeholder":"How can we help?","type":"long_text","props":{"minLength":null,"maxLength":null,"rows":6,"richText":false}}],"endScreen":{"title":"Message sent","message":"Thanks for getting in touch. We usually reply within one working day.","redirectUrl":null}}'::jsonb, '{"closed":false,"closeAt":null,"timezone":"UTC","responseCap":null,"closedMessage":"This form is no longer accepting responses.","onePerBrowser":false,"onePerEmail":false,"onePerEmailFieldId":null,"passwordHash":null,"afterSubmit":"end_screen","redirectUrl":null,"redirectAppendAnswers":false,"stepSound":"off","notifyOnResponse":false,"notifyRecipients":[],"confirmationEmail":false,"confirmationEmailFieldId":null,"confirmationSubject":"Thanks for your response","confirmationBody":"We received your response. Thanks for taking the time.","webhook":{"enabled":false,"url":null,"headers":[]},"seoTitle":"","seoDescription":"","ogImage":null,"noindex":true,"showOnFrontPage":false,"frontPageDescription":""}'::jsonb, '{"preset":"intelform","colors":{"background":"#F5F2EA","question":"#211D2A","answer":"#6C48CA","button":"#C9C0FF","buttonText":"#211D2A"},"font":"Figtree","questionFont":"Instrument Serif","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, false, 3, now() - interval '48960 minutes', now() - interval '48960 minutes'),
  ('00000000-0000-4000-8000-00000000f002', 'how-are-we-doing', 'How are we doing?', 'live', '{"layout":"one_at_a_time","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_npsscore","label":"How likely are you to recommend us to a friend or colleague?","required":true,"type":"nps","props":{"lowLabel":"Not likely","highLabel":"Extremely likely"}},{"id":"f_npslow","label":"What’s the main reason for your score? What could we do better?","required":false,"logic":{"action":"show","match":"all","conditions":[{"field":"f_npsscore","op":"lte","value":6}]},"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":4,"richText":false}},{"id":"f_npshigh","label":"What’s the main reason for your score? What do you like most?","required":false,"logic":{"action":"show","match":"all","conditions":[{"field":"f_npsscore","op":"gte","value":7}]},"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":4,"richText":false}},{"id":"f_npsemail","label":"Your email","description":"Optional. Leave it if you’re happy for us to follow up.","required":false,"type":"email","props":{"blockFreeDomains":false}}],"endScreen":{"title":"Thanks for your feedback","message":"We read every response.","redirectUrl":null}}'::jsonb, '{"closed":false,"closeAt":null,"timezone":"UTC","responseCap":null,"closedMessage":"This form is no longer accepting responses.","onePerBrowser":false,"onePerEmail":false,"onePerEmailFieldId":null,"passwordHash":null,"afterSubmit":"end_screen","redirectUrl":null,"redirectAppendAnswers":false,"stepSound":"off","notifyOnResponse":false,"notifyRecipients":[],"confirmationEmail":false,"confirmationEmailFieldId":null,"confirmationSubject":"Thanks for your response","confirmationBody":"We received your response. Thanks for taking the time.","webhook":{"enabled":false,"url":null,"headers":[]},"seoTitle":"","seoDescription":"","ogImage":null,"noindex":false,"showOnFrontPage":true,"frontPageDescription":"Tell us how we are doing. One question, two minutes."}'::jsonb, '{"preset":"intelform","colors":{"background":"#F5F2EA","question":"#211D2A","answer":"#6C48CA","button":"#C9C0FF","buttonText":"#211D2A"},"font":"Figtree","questionFont":"Instrument Serif","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, false, 3, now() - interval '43200 minutes', now() - interval '43200 minutes'),
  ('00000000-0000-4000-8000-00000000f003', 'spring-meetup', 'Spring meetup registration', 'live', '{"layout":"all_at_once","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_evname","label":"Name","required":true,"type":"name","props":{"split":true}},{"id":"f_evemail","label":"Email","description":"We send your confirmation here.","required":true,"type":"email","props":{"blockFreeDomains":false}},{"id":"f_evphone","label":"Phone","required":false,"type":"phone","props":{"defaultCountry":null}},{"id":"f_evsess","label":"Which session will you attend?","required":true,"type":"single_choice","props":{"options":[{"id":"o_evs1","label":"Morning (9:00 to 12:00)"},{"id":"o_evs2","label":"Afternoon (13:00 to 16:00)"},{"id":"o_evs3","label":"Both"}],"other":false,"randomize":false,"orientation":"vertical"}},{"id":"f_evneeds","label":"Dietary or access needs","description":"Optional. Tell us anything that helps you take part.","required":false,"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":3,"richText":false}},{"id":"f_evcons","label":"Consent","required":true,"hideLabel":true,"type":"consent","props":{"text":"I agree to my details being used to manage this event","link":null}}],"endScreen":{"title":"You’re registered, {f_evname.first|there}!","message":"See you there.","redirectUrl":null}}'::jsonb, '{"closed":false,"closeAt":null,"timezone":"Europe/London","responseCap":null,"closedMessage":"This form is no longer accepting responses.","onePerBrowser":false,"onePerEmail":true,"onePerEmailFieldId":"f_evemail","passwordHash":null,"afterSubmit":"end_screen","redirectUrl":null,"redirectAppendAnswers":false,"stepSound":"off","notifyOnResponse":false,"notifyRecipients":[],"confirmationEmail":false,"confirmationEmailFieldId":null,"confirmationSubject":"Thanks for your response","confirmationBody":"We received your response. Thanks for taking the time.","webhook":{"enabled":false,"url":null,"headers":[]},"seoTitle":"","seoDescription":"","ogImage":null,"noindex":false,"showOnFrontPage":true,"frontPageDescription":"A morning of talks and an afternoon of workshops. Free, with lunch."}'::jsonb, '{"preset":"linen","colors":{"background":"#FAF8F3","question":"#1F2A24","answer":"#0F6E5C","button":"#0F6E5C","buttonText":"#FFFFFF"},"font":"Source Sans 3","questionFont":"Lora","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, false, 3, now() - interval '28800 minutes', now() - interval '27360 minutes'),
  ('00000000-0000-4000-8000-00000000f004', 'order-feedback', 'Order feedback', 'live', '{"layout":"one_at_a_time","startScreen":{"enabled":true,"title":"How did we do?","description":"Four quick questions about your recent order.","button":"Start","minutes":1},"fields":[{"id":"f_ppstar","label":"How would you rate your purchase?","required":true,"type":"rating","props":{"style":"stars","scale":5,"leftLabel":"","rightLabel":""}},{"id":"f_pplike","label":"What did you like?","description":"Choose all that apply.","required":false,"type":"multiple_choice","props":{"options":[{"id":"o_ppl1","label":"Product quality"},{"id":"o_ppl2","label":"Price"},{"id":"o_ppl3","label":"Delivery speed"},{"id":"o_ppl4","label":"Packaging"},{"id":"o_ppl5","label":"Customer service"}],"other":true,"randomize":false,"orientation":"vertical","minSelections":null,"maxSelections":null}},{"id":"f_ppagain","label":"Would you buy from us again?","required":true,"type":"yes_no","props":{"yesLabel":"Yes","noLabel":"No"}},{"id":"f_ppnote","label":"Any other comments?","required":false,"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":4,"richText":false}}],"endScreen":{"title":"Thank you!","message":"Your feedback helps us get better.","redirectUrl":null}}'::jsonb, '{"closed":false,"closeAt":null,"timezone":"UTC","responseCap":null,"closedMessage":"This form is no longer accepting responses.","onePerBrowser":false,"onePerEmail":false,"onePerEmailFieldId":null,"passwordHash":null,"afterSubmit":"end_screen","redirectUrl":null,"redirectAppendAnswers":false,"stepSound":"off","notifyOnResponse":false,"notifyRecipients":[],"confirmationEmail":false,"confirmationEmailFieldId":null,"confirmationSubject":"Thanks for your response","confirmationBody":"We received your response. Thanks for taking the time.","webhook":{"enabled":false,"url":null,"headers":[]},"seoTitle":"","seoDescription":"","ogImage":null,"noindex":true,"showOnFrontPage":false,"frontPageDescription":""}'::jsonb, '{"preset":"apricot","colors":{"background":"#FFF6EE","question":"#3B1D0E","answer":"#B4460F","button":"#B4460F","buttonText":"#FFFFFF"},"font":"Nunito","questionFont":null,"fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"pill","alignment":"left"}'::jsonb, false, 6, now() - interval '37440 minutes', now() - interval '17280 minutes'),
  ('00000000-0000-4000-8000-00000000f005', 'beta-waitlist', 'Beta waitlist', 'closed', '{"layout":"one_at_a_time","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_wlemail","label":"What’s your email?","required":true,"placeholder":"name@example.com","type":"email","props":{"blockFreeDomains":false}},{"id":"f_wlname","label":"And your name?","required":false,"type":"name","props":{"split":false}},{"id":"f_wlsrc","label":"How did you hear about us?","required":false,"type":"dropdown","props":{"options":[{"id":"o_wls1","label":"Search engine"},{"id":"o_wls2","label":"Social media"},{"id":"o_wls3","label":"A friend or colleague"},{"id":"o_wls4","label":"Newsletter or blog"},{"id":"o_wls5","label":"Event"},{"id":"o_wls6","label":"Other"}],"searchable":false,"randomize":false}}],"endScreen":{"title":"You’re on the list","message":"We’ll email you as soon as it’s your turn.","redirectUrl":null}}'::jsonb, '{"closed":true,"closeAt":null,"timezone":"UTC","responseCap":null,"closedMessage":"The beta is full. Thanks for your interest!","onePerBrowser":false,"onePerEmail":true,"onePerEmailFieldId":"f_wlemail","passwordHash":null,"afterSubmit":"end_screen","redirectUrl":null,"redirectAppendAnswers":false,"stepSound":"off","notifyOnResponse":false,"notifyRecipients":[],"confirmationEmail":false,"confirmationEmailFieldId":null,"confirmationSubject":"Thanks for your response","confirmationBody":"We received your response. Thanks for taking the time.","webhook":{"enabled":false,"url":null,"headers":[]},"seoTitle":"","seoDescription":"","ogImage":null,"noindex":true,"showOnFrontPage":false,"frontPageDescription":""}'::jsonb, '{"preset":"intelform","colors":{"background":"#F5F2EA","question":"#211D2A","answer":"#6C48CA","button":"#C9C0FF","buttonText":"#211D2A"},"font":"Figtree","questionFont":"Instrument Serif","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, false, 3, now() - interval '86400 minutes', now() - interval '44640 minutes'),
  ('00000000-0000-4000-8000-00000000f006', 'junior-designer', 'Junior designer application', 'draft', '{"layout":"section_by_section","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_apsec1","label":"About you","description":"How we can reach you.","required":false,"type":"section_break","props":{}},{"id":"f_apname","label":"Full name","required":true,"type":"name","props":{"split":true}},{"id":"f_apemail","label":"Email","required":true,"type":"email","props":{"blockFreeDomains":false}},{"id":"f_apphone","label":"Phone","required":true,"type":"phone","props":{"defaultCountry":null}},{"id":"f_apaddr","label":"Address","required":false,"type":"address","props":{"lines":{"street":true,"line2":true,"city":true,"state":true,"postal":true,"country":true},"defaultCountry":null}},{"id":"f_apsec2","label":"Your experience","description":"Tell us about your work so far.","required":false,"type":"section_break","props":{}},{"id":"f_apport","label":"Portfolio or LinkedIn","required":false,"placeholder":"https://","type":"url","props":{}},{"id":"f_apyears","label":"Years of relevant experience","required":true,"type":"number","props":{"min":0,"max":60,"allowDecimals":false,"prefix":"","suffix":""}},{"id":"f_apwhy","label":"Why are you a good fit?","required":true,"type":"long_text","props":{"minLength":null,"maxLength":3000,"rows":6,"richText":false}},{"id":"f_apsec3","label":"Availability","required":false,"type":"section_break","props":{}},{"id":"f_apstart","label":"Earliest start date","required":true,"type":"date","props":{"format":"DD/MM/YYYY","minDate":null,"maxDate":null,"disablePast":true,"disableFuture":false}},{"id":"f_apcons","label":"Consent","required":true,"hideLabel":true,"type":"consent","props":{"text":"I confirm the information above is accurate and agree to it being stored for this application","link":null}}],"endScreen":{"title":"Application received","message":"Thanks, {f_apname.first|there}. We review every application and will reply by email.","redirectUrl":null}}'::jsonb, '{"closed":false,"closeAt":null,"timezone":"Europe/London","responseCap":null,"closedMessage":"This form is no longer accepting responses.","onePerBrowser":false,"onePerEmail":true,"onePerEmailFieldId":"f_apemail","passwordHash":null,"afterSubmit":"end_screen","redirectUrl":null,"redirectAppendAnswers":false,"stepSound":"off","notifyOnResponse":false,"notifyRecipients":[],"confirmationEmail":false,"confirmationEmailFieldId":null,"confirmationSubject":"Thanks for your response","confirmationBody":"We received your response. Thanks for taking the time.","webhook":{"enabled":false,"url":null,"headers":[]},"seoTitle":"","seoDescription":"","ogImage":null,"noindex":true,"showOnFrontPage":false,"frontPageDescription":""}'::jsonb, '{"preset":"intelform","colors":{"background":"#F5F2EA","question":"#211D2A","answer":"#6C48CA","button":"#C9C0FF","buttonText":"#211D2A"},"font":"Figtree","questionFont":"Instrument Serif","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, false, 9, now() - interval '2880 minutes', now() - interval '180 minutes')
ON CONFLICT DO NOTHING;

INSERT INTO "form_versions" ("id", "form_id", "version", "definition", "theme", "published_at") VALUES
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000f001', 1, '{"layout":"all_at_once","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_csname","label":"Name","required":true,"type":"name","props":{"split":false}},{"id":"f_csemail","label":"Email","description":"We reply to this address.","required":true,"type":"email","props":{"blockFreeDomains":false}},{"id":"f_cstopic","label":"Topic","required":true,"type":"dropdown","props":{"options":[{"id":"o_cst1","label":"General question"},{"id":"o_cst2","label":"Account or billing"},{"id":"o_cst3","label":"Technical problem"},{"id":"o_cst4","label":"Feedback"},{"id":"o_cst5","label":"Other"}],"searchable":false,"randomize":false}},{"id":"f_csmsg","label":"Message","required":true,"placeholder":"How can we help?","type":"long_text","props":{"minLength":null,"maxLength":null,"rows":6,"richText":false}}],"endScreen":{"title":"Message sent","message":"Thanks for getting in touch. We usually reply within one working day.","redirectUrl":null}}'::jsonb, '{"preset":"intelform","colors":{"background":"#F5F2EA","question":"#211D2A","answer":"#6C48CA","button":"#C9C0FF","buttonText":"#211D2A"},"font":"Figtree","questionFont":"Instrument Serif","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, now() - interval '48960 minutes'),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000f002', 1, '{"layout":"one_at_a_time","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_npsscore","label":"How likely are you to recommend us to a friend or colleague?","required":true,"type":"nps","props":{"lowLabel":"Not likely","highLabel":"Extremely likely"}},{"id":"f_npslow","label":"What’s the main reason for your score? What could we do better?","required":false,"logic":{"action":"show","match":"all","conditions":[{"field":"f_npsscore","op":"lte","value":6}]},"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":4,"richText":false}},{"id":"f_npshigh","label":"What’s the main reason for your score? What do you like most?","required":false,"logic":{"action":"show","match":"all","conditions":[{"field":"f_npsscore","op":"gte","value":7}]},"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":4,"richText":false}},{"id":"f_npsemail","label":"Your email","description":"Optional. Leave it if you’re happy for us to follow up.","required":false,"type":"email","props":{"blockFreeDomains":false}}],"endScreen":{"title":"Thanks for your feedback","message":"We read every response.","redirectUrl":null}}'::jsonb, '{"preset":"intelform","colors":{"background":"#F5F2EA","question":"#211D2A","answer":"#6C48CA","button":"#C9C0FF","buttonText":"#211D2A"},"font":"Figtree","questionFont":"Instrument Serif","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, now() - interval '43200 minutes'),
  ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-00000000f003', 1, '{"layout":"all_at_once","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_evname","label":"Name","required":true,"type":"name","props":{"split":true}},{"id":"f_evemail","label":"Email","description":"We send your confirmation here.","required":true,"type":"email","props":{"blockFreeDomains":false}},{"id":"f_evphone","label":"Phone","required":false,"type":"phone","props":{"defaultCountry":null}},{"id":"f_evsess","label":"Which session will you attend?","required":true,"type":"single_choice","props":{"options":[{"id":"o_evs1","label":"Morning (9:00 to 12:00)"},{"id":"o_evs2","label":"Afternoon (13:00 to 16:00)"},{"id":"o_evs3","label":"Both"}],"other":false,"randomize":false,"orientation":"vertical"}},{"id":"f_evneeds","label":"Dietary or access needs","description":"Optional. Tell us anything that helps you take part.","required":false,"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":3,"richText":false}},{"id":"f_evcons","label":"Consent","required":true,"hideLabel":true,"type":"consent","props":{"text":"I agree to my details being used to manage this event","link":null}}],"endScreen":{"title":"You’re registered, {f_evname.first|there}!","message":"See you there.","redirectUrl":null}}'::jsonb, '{"preset":"linen","colors":{"background":"#FAF8F3","question":"#1F2A24","answer":"#0F6E5C","button":"#0F6E5C","buttonText":"#FFFFFF"},"font":"Source Sans 3","questionFont":"Lora","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, now() - interval '27360 minutes'),
  ('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-00000000f004', 1, '{"layout":"one_at_a_time","startScreen":{"enabled":true,"title":"How did we do?","description":"Four quick questions about your recent order.","button":"Start","minutes":1},"fields":[{"id":"f_ppstar","label":"How would you rate your purchase?","required":true,"type":"rating","props":{"style":"stars","scale":5,"leftLabel":"","rightLabel":""}},{"id":"f_pplike","label":"What did you like?","description":"Choose all that apply.","required":false,"type":"multiple_choice","props":{"options":[{"id":"o_ppl1","label":"Product quality"},{"id":"o_ppl2","label":"Price"},{"id":"o_ppl3","label":"Delivery speed"},{"id":"o_ppl4","label":"Packaging"},{"id":"o_ppl5","label":"Customer service"}],"other":true,"randomize":false,"orientation":"vertical","minSelections":null,"maxSelections":null}},{"id":"f_ppagain","label":"Would you buy from us again?","required":true,"type":"yes_no","props":{"yesLabel":"Yes","noLabel":"No"}}],"endScreen":{"title":"Thank you!","message":"Your feedback helps us get better.","redirectUrl":null}}'::jsonb, '{"preset":"apricot","colors":{"background":"#FFF6EE","question":"#3B1D0E","answer":"#B4460F","button":"#B4460F","buttonText":"#FFFFFF"},"font":"Nunito","questionFont":null,"fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"pill","alignment":"left"}'::jsonb, now() - interval '37440 minutes'),
  ('00000000-0000-4000-8000-00000000b004', '00000000-0000-4000-8000-00000000f004', 2, '{"layout":"one_at_a_time","startScreen":{"enabled":true,"title":"How did we do?","description":"Four quick questions about your recent order.","button":"Start","minutes":1},"fields":[{"id":"f_ppstar","label":"How would you rate your purchase?","required":true,"type":"rating","props":{"style":"stars","scale":5,"leftLabel":"","rightLabel":""}},{"id":"f_pplike","label":"What did you like?","description":"Choose all that apply.","required":false,"type":"multiple_choice","props":{"options":[{"id":"o_ppl1","label":"Product quality"},{"id":"o_ppl2","label":"Price"},{"id":"o_ppl3","label":"Delivery speed"},{"id":"o_ppl4","label":"Packaging"},{"id":"o_ppl5","label":"Customer service"}],"other":true,"randomize":false,"orientation":"vertical","minSelections":null,"maxSelections":null}},{"id":"f_ppagain","label":"Would you buy from us again?","required":true,"type":"yes_no","props":{"yesLabel":"Yes","noLabel":"No"}},{"id":"f_ppnote","label":"Any other comments?","required":false,"type":"long_text","props":{"minLength":null,"maxLength":null,"rows":4,"richText":false}}],"endScreen":{"title":"Thank you!","message":"Your feedback helps us get better.","redirectUrl":null}}'::jsonb, '{"preset":"apricot","colors":{"background":"#FFF6EE","question":"#3B1D0E","answer":"#B4460F","button":"#B4460F","buttonText":"#FFFFFF"},"font":"Nunito","questionFont":null,"fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"pill","alignment":"left"}'::jsonb, now() - interval '17280 minutes'),
  ('00000000-0000-4000-8000-00000000a005', '00000000-0000-4000-8000-00000000f005', 1, '{"layout":"one_at_a_time","startScreen":{"enabled":false,"title":"","button":"Start"},"fields":[{"id":"f_wlemail","label":"What’s your email?","required":true,"placeholder":"name@example.com","type":"email","props":{"blockFreeDomains":false}},{"id":"f_wlname","label":"And your name?","required":false,"type":"name","props":{"split":false}},{"id":"f_wlsrc","label":"How did you hear about us?","required":false,"type":"dropdown","props":{"options":[{"id":"o_wls1","label":"Search engine"},{"id":"o_wls2","label":"Social media"},{"id":"o_wls3","label":"A friend or colleague"},{"id":"o_wls4","label":"Newsletter or blog"},{"id":"o_wls5","label":"Event"},{"id":"o_wls6","label":"Other"}],"searchable":false,"randomize":false}}],"endScreen":{"title":"You’re on the list","message":"We’ll email you as soon as it’s your turn.","redirectUrl":null}}'::jsonb, '{"preset":"intelform","colors":{"background":"#F5F2EA","question":"#211D2A","answer":"#6C48CA","button":"#C9C0FF","buttonText":"#211D2A"},"font":"Figtree","questionFont":"Instrument Serif","fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, now() - interval '84960 minutes')
ON CONFLICT DO NOTHING;

-- The live version of each published form.

UPDATE "forms" SET "published_version_id" = '00000000-0000-4000-8000-00000000a001' WHERE "id" = '00000000-0000-4000-8000-00000000f001' AND "published_version_id" IS NULL;

UPDATE "forms" SET "published_version_id" = '00000000-0000-4000-8000-00000000a002' WHERE "id" = '00000000-0000-4000-8000-00000000f002' AND "published_version_id" IS NULL;

UPDATE "forms" SET "published_version_id" = '00000000-0000-4000-8000-00000000a003' WHERE "id" = '00000000-0000-4000-8000-00000000f003' AND "published_version_id" IS NULL;

UPDATE "forms" SET "published_version_id" = '00000000-0000-4000-8000-00000000b004' WHERE "id" = '00000000-0000-4000-8000-00000000f004' AND "published_version_id" IS NULL;

UPDATE "forms" SET "published_version_id" = '00000000-0000-4000-8000-00000000a005' WHERE "id" = '00000000-0000-4000-8000-00000000f005' AND "published_version_id" IS NULL;

-- An old link that still redirects to "Contact us".
INSERT INTO "form_slugs_old" ("slug", "form_id", "created_at") VALUES
  ('support', '00000000-0000-4000-8000-00000000f001', now() - interval '48900 minutes')
ON CONFLICT DO NOTHING;

INSERT INTO "responses" ("id", "form_id", "form_version_id", "answers", "started_at", "submitted_at", "duration_ms", "country", "device", "browser", "search_text", "ttc", "email_key") VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Ada Lovelace","f_csemail":"ada@example.com","f_cstopic":{"option":"o_cst3"},"f_csmsg":"The export button does nothing when I pick CSV."}'::jsonb, now() - interval '4320 minutes' - interval '143393 milliseconds', now() - interval '4320 minutes', 143393, 'GB', 'desktop', 'Firefox', 'Ada Lovelace
ada@example.com
The export button does nothing when I pick CSV.', '{"f_csname":12782,"f_csemail":9001,"f_cstopic":2308,"f_csmsg":8602}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Grace Hopper","f_csemail":"grace@example.com","f_cstopic":{"option":"o_cst2"},"f_csmsg":"Please send me last month’s invoice again."}'::jsonb, now() - interval '2880 minutes' - interval '44208 milliseconds', now() - interval '2880 minutes', 44208, 'US', 'mobile', 'Safari', 'Grace Hopper
grace@example.com
Please send me last month’s invoice again.', '{"f_csname":6151,"f_csemail":10878,"f_cstopic":12097,"f_csmsg":11184}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Alan Turing","f_csemail":"alan@example.com","f_cstopic":{"option":"o_cst4"},"f_csmsg":"Lovely product. A dark mode for forms would be great."}'::jsonb, now() - interval '300 minutes' - interval '58163 milliseconds', now() - interval '300 minutes', 58163, 'GB', 'desktop', 'Chrome', 'Alan Turing
alan@example.com
Lovely product. A dark mode for forms would be great.', '{"f_csname":7038,"f_csemail":12598,"f_cstopic":5037,"f_csmsg":11321}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Katherine Johnson","f_csemail":"katherine@example.com","f_cstopic":{"option":"o_cst1"},"f_csmsg":"Do you offer a discount for schools?"}'::jsonb, now() - interval '39080 minutes' - interval '79748 milliseconds', now() - interval '39080 minutes', 79748, 'US', 'desktop', 'Chrome', 'Katherine Johnson
katherine@example.com
Do you offer a discount for schools?', '{"f_csname":12579,"f_csemail":10201,"f_cstopic":4428,"f_csmsg":10238}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Linus Ek","f_csemail":"linus@example.com","f_cstopic":{"option":"o_cst3"},"f_csmsg":"I can’t upload a logo larger than 2 MB. Is that a limit?"}'::jsonb, now() - interval '31725 minutes' - interval '53393 milliseconds', now() - interval '31725 minutes', 53393, 'SE', 'desktop', 'Firefox', 'Linus Ek
linus@example.com
I can’t upload a logo larger than 2 MB. Is that a limit?', '{"f_csname":10096,"f_csemail":10072,"f_cstopic":11749,"f_csmsg":3048}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Mei Tanaka","f_csemail":"mei@example.com","f_cstopic":{"option":"o_cst5"},"f_csmsg":"Can I embed a form on my own website?"}'::jsonb, now() - interval '26530 minutes' - interval '110704 milliseconds', now() - interval '26530 minutes', 110704, 'JP', 'mobile', 'Safari', 'Mei Tanaka
mei@example.com
Can I embed a form on my own website?', '{"f_csname":8343,"f_csemail":3607,"f_cstopic":2798,"f_csmsg":7957}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Grace Hopper","f_csemail":"grace@example.com","f_cstopic":{"option":"o_cst2"},"f_csmsg":"How do I change the card we pay with?"}'::jsonb, now() - interval '18810 minutes' - interval '32430 milliseconds', now() - interval '18810 minutes', 32430, 'US', 'desktop', 'Edge', 'Grace Hopper
grace@example.com
How do I change the card we pay with?', '{"f_csname":6118,"f_csemail":13574,"f_cstopic":2058,"f_csmsg":2656}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Omar Haddad","f_csemail":"omar@example.com","f_cstopic":{"option":"o_cst4"},"f_csmsg":"The new templates saved me an afternoon. Thank you!"}'::jsonb, now() - interval '13260 minutes' - interval '163722 milliseconds', now() - interval '13260 minutes', 163722, 'AE', 'tablet', 'Safari', 'Omar Haddad
omar@example.com
The new templates saved me an afternoon. Thank you!', '{"f_csname":8841,"f_csemail":6859,"f_cstopic":13010,"f_csmsg":11586}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Priya Natarajan","f_csemail":"priya@example.com","f_cstopic":{"option":"o_cst3"},"f_csmsg":"Responses page shows a blank chart for one of my questions."}'::jsonb, now() - interval '8660 minutes' - interval '36364 milliseconds', now() - interval '8660 minutes', 36364, 'IN', 'desktop', 'Chrome', 'Priya Natarajan
priya@example.com
Responses page shows a blank chart for one of my questions.', '{"f_csname":7111,"f_csemail":8948,"f_cstopic":13585,"f_csmsg":6935}'::jsonb, NULL),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000a001', '{"f_csname":"Lucas Martin","f_csemail":"lucas@example.com","f_cstopic":{"option":"o_cst1"},"f_csmsg":"Is there a limit on how many forms I can make?"}'::jsonb, now() - interval '1840 minutes' - interval '108570 milliseconds', now() - interval '1840 minutes', 108570, 'FR', 'mobile', 'Chrome', 'Lucas Martin
lucas@example.com
Is there a limit on how many forms I can make?', '{"f_csname":6191,"f_csemail":6635,"f_cstopic":2115,"f_csmsg":5208}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":10,"f_npshigh":"Fast and simple to set up.","f_npsemail":"ada@example.com"}'::jsonb, now() - interval '8640 minutes' - interval '110198 milliseconds', now() - interval '8640 minutes', 110198, 'GB', 'desktop', 'Firefox', 'Fast and simple to set up.
ada@example.com', '{"f_npsscore":13435,"f_npshigh":8741,"f_npsemail":11973}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":8,"f_npshigh":"Good templates."}'::jsonb, now() - interval '5760 minutes' - interval '144599 milliseconds', now() - interval '5760 minutes', 144599, 'DE', 'mobile', 'Chrome', 'Good templates.', '{"f_npsscore":11227,"f_npshigh":3235}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":5,"f_npslow":"I would like more chart types.","f_npsemail":"sam@example.com"}'::jsonb, now() - interval '1440 minutes' - interval '92183 milliseconds', now() - interval '1440 minutes', 92183, 'US', 'tablet', 'Safari', 'I would like more chart types.
sam@example.com', '{"f_npsscore":10653,"f_npslow":11762,"f_npsemail":10771}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":9}'::jsonb, now() - interval '120 minutes' - interval '131612 milliseconds', now() - interval '120 minutes', 131612, 'FR', 'desktop', 'Edge', '', '{"f_npsscore":2859}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":9,"f_npshigh":"The builder feels calm and quick.","f_npsemail":"mei@example.com"}'::jsonb, now() - interval '40420 minutes' - interval '170484 milliseconds', now() - interval '40420 minutes', 170484, 'JP', 'desktop', 'Chrome', 'The builder feels calm and quick.
mei@example.com', '{"f_npsscore":10538,"f_npshigh":8156,"f_npsemail":8036}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":3,"f_npslow":"Exports took too long on a big form.","f_npsemail":"linus@example.com"}'::jsonb, now() - interval '36700 minutes' - interval '69875 milliseconds', now() - interval '36700 minutes', 69875, 'SE', 'desktop', 'Firefox', 'Exports took too long on a big form.
linus@example.com', '{"f_npsscore":10298,"f_npslow":8971,"f_npsemail":3812}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":10,"f_npshigh":"Logic rules are easy to understand."}'::jsonb, now() - interval '30270 minutes' - interval '101236 milliseconds', now() - interval '30270 minutes', 101236, 'NL', 'mobile', 'Safari', 'Logic rules are easy to understand.', '{"f_npsscore":11116,"f_npshigh":12475}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":7}'::jsonb, now() - interval '25000 minutes' - interval '149008 milliseconds', now() - interval '25000 minutes', 149008, 'CA', 'desktop', 'Chrome', '', '{"f_npsscore":13466}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":6,"f_npslow":"Fine, but I miss a calendar field.","f_npsemail":"omar@example.com"}'::jsonb, now() - interval '20420 minutes' - interval '59694 milliseconds', now() - interval '20420 minutes', 59694, 'AE', 'mobile', 'Chrome', 'Fine, but I miss a calendar field.
omar@example.com', '{"f_npsscore":7428,"f_npslow":6173,"f_npsemail":2105}'::jsonb, NULL),
  ('00000000-0000-4000-8000-00000000001a', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":10,"f_npshigh":"Support answered in an hour.","f_npsemail":"grace@example.com"}'::jsonb, now() - interval '15920 minutes' - interval '85845 milliseconds', now() - interval '15920 minutes', 85845, 'US', 'desktop', 'Safari', 'Support answered in an hour.
grace@example.com', '{"f_npsscore":8262,"f_npshigh":6848,"f_npsemail":7583}'::jsonb, NULL),
  ('00000000-0000-4000-8000-00000000001b', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":8,"f_npshigh":"Clean design, respondents like it."}'::jsonb, now() - interval '12420 minutes' - interval '146868 milliseconds', now() - interval '12420 minutes', 146868, 'BR', 'mobile', 'Chrome', 'Clean design, respondents like it.', '{"f_npsscore":10225,"f_npshigh":12099}'::jsonb, NULL),
  ('00000000-0000-4000-8000-00000000001c', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000a002', '{"f_npsscore":9,"f_npshigh":"Webhooks just worked.","f_npsemail":"priya@example.com"}'::jsonb, now() - interval '4650 minutes' - interval '33107 milliseconds', now() - interval '4650 minutes', 33107, 'IN', 'desktop', 'Chrome', 'Webhooks just worked.
priya@example.com', '{"f_npsscore":12766,"f_npshigh":8962,"f_npsemail":11369}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Ada","last":"Lovelace"},"f_evemail":"ada@example.com","f_evphone":"+447700900123","f_evsess":{"option":"o_evs3"},"f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '27240 minutes' - interval '101530 milliseconds', now() - interval '27240 minutes', 101530, 'GB', 'desktop', 'Firefox', 'Ada Lovelace
ada@example.com
+447700900123', '{"f_evname":2332,"f_evemail":6837,"f_evphone":10372,"f_evsess":9613,"f_evcons":4728}'::jsonb, 'ada@example.com'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Grace","last":"Hopper"},"f_evemail":"grace@example.com","f_evphone":"+12025550143","f_evsess":{"option":"o_evs1"},"f_evneeds":"Vegetarian lunch, please.","f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '25970 minutes' - interval '128328 milliseconds', now() - interval '25970 minutes', 128328, 'US', 'desktop', 'Safari', 'Grace Hopper
grace@example.com
+12025550143
Vegetarian lunch, please.', '{"f_evname":4608,"f_evemail":11928,"f_evphone":9496,"f_evsess":11248,"f_evneeds":10495,"f_evcons":8235}'::jsonb, 'grace@example.com'),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Ravi","last":"Kumar"},"f_evemail":"ravi@example.com","f_evsess":{"option":"o_evs2"},"f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '23440 minutes' - interval '26332 milliseconds', now() - interval '23440 minutes', 26332, 'IN', 'mobile', 'Chrome', 'Ravi Kumar
ravi@example.com', '{"f_evname":13503,"f_evemail":9049,"f_evsess":6353,"f_evcons":8547}'::jsonb, 'ravi@example.com'),
  ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Sofia","last":"Rossi"},"f_evemail":"sofia@example.com","f_evphone":"+393123456789","f_evsess":{"option":"o_evs3"},"f_evneeds":"I use a wheelchair: step-free access?","f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '21610 minutes' - interval '144362 milliseconds', now() - interval '21610 minutes', 144362, 'IT', 'mobile', 'Safari', 'Sofia Rossi
sofia@example.com
+393123456789
I use a wheelchair: step-free access?', '{"f_evname":9858,"f_evemail":10706,"f_evphone":6783,"f_evsess":4921,"f_evneeds":4355,"f_evcons":5019}'::jsonb, 'sofia@example.com'),
  ('00000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Linus","last":"Ek"},"f_evemail":"linus@example.com","f_evsess":{"option":"o_evs1"},"f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '17980 minutes' - interval '30337 milliseconds', now() - interval '17980 minutes', 30337, 'SE', 'desktop', 'Firefox', 'Linus Ek
linus@example.com', '{"f_evname":6766,"f_evemail":2540,"f_evsess":10113,"f_evcons":4580}'::jsonb, 'linus@example.com'),
  ('00000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Amara","last":"Okafor"},"f_evemail":"amara@example.com","f_evphone":"+2348031234567","f_evsess":{"option":"o_evs3"},"f_evneeds":"Gluten-free.","f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '14620 minutes' - interval '79103 milliseconds', now() - interval '14620 minutes', 79103, 'NG', 'mobile', 'Chrome', 'Amara Okafor
amara@example.com
+2348031234567
Gluten-free.', '{"f_evname":9223,"f_evemail":13026,"f_evphone":6713,"f_evsess":6858,"f_evneeds":12061,"f_evcons":5824}'::jsonb, 'amara@example.com'),
  ('00000000-0000-4000-8000-000000000027', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Tom","last":"Becker"},"f_evemail":"tom@example.com","f_evphone":"+4915123456789","f_evsess":{"option":"o_evs2"},"f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '10120 minutes' - interval '166544 milliseconds', now() - interval '10120 minutes', 166544, 'DE', 'desktop', 'Chrome', 'Tom Becker
tom@example.com
+4915123456789', '{"f_evname":12525,"f_evemail":11093,"f_evphone":4898,"f_evsess":7116,"f_evcons":7271}'::jsonb, 'tom@example.com'),
  ('00000000-0000-4000-8000-000000000028', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Mei","last":"Tanaka"},"f_evemail":"mei@example.com","f_evsess":{"option":"o_evs1"},"f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '6360 minutes' - interval '92958 milliseconds', now() - interval '6360 minutes', 92958, 'JP', 'tablet', 'Safari', 'Mei Tanaka
mei@example.com', '{"f_evname":2829,"f_evemail":6319,"f_evsess":11987,"f_evcons":11469}'::jsonb, 'mei@example.com'),
  ('00000000-0000-4000-8000-000000000029', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000a003', '{"f_evname":{"first":"Alan","last":"Turing"},"f_evemail":"alan@example.com","f_evphone":"+447700900456","f_evsess":{"option":"o_evs3"},"f_evneeds":"Vegan.","f_evcons":{"accepted":true,"text":"I agree to my details being used to manage this event","version":1}}'::jsonb, now() - interval '1200 minutes' - interval '110894 milliseconds', now() - interval '1200 minutes', 110894, 'GB', 'desktop', 'Chrome', 'Alan Turing
alan@example.com
+447700900456
Vegan.', '{"f_evname":3160,"f_evemail":5302,"f_evphone":3831,"f_evsess":11000,"f_evneeds":8793,"f_evcons":6619}'::jsonb, 'alan@example.com'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000a004', '{"f_ppstar":5,"f_pplike":[{"option":"o_ppl1"},{"option":"o_ppl3"}],"f_ppagain":true}'::jsonb, now() - interval '36300 minutes' - interval '28216 milliseconds', now() - interval '36300 minutes', 28216, 'GB', 'mobile', 'Safari', '', '{"f_ppstar":4357,"f_pplike":5838,"f_ppagain":3072}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000a004', '{"f_ppstar":4,"f_pplike":[{"option":"o_ppl2"}],"f_ppagain":true}'::jsonb, now() - interval '33200 minutes' - interval '40166 milliseconds', now() - interval '33200 minutes', 40166, 'US', 'desktop', 'Chrome', '', '{"f_ppstar":13061,"f_pplike":11540,"f_ppagain":12147}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000a004', '{"f_ppstar":2,"f_pplike":[{"option":"o_other","other":"Nothing, the box arrived damaged"}],"f_ppagain":false}'::jsonb, now() - interval '29400 minutes' - interval '44097 milliseconds', now() - interval '29400 minutes', 44097, 'DE', 'mobile', 'Chrome', 'Nothing, the box arrived damaged', '{"f_ppstar":8182,"f_pplike":12401,"f_ppagain":2507}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000a004', '{"f_ppstar":5,"f_pplike":[{"option":"o_ppl1"},{"option":"o_ppl4"},{"option":"o_ppl5"}],"f_ppagain":true}'::jsonb, now() - interval '21645 minutes' - interval '95803 milliseconds', now() - interval '21645 minutes', 95803, 'FR', 'desktop', 'Firefox', '', '{"f_ppstar":12023,"f_pplike":3788,"f_ppagain":8094}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000b004', '{"f_ppstar":4,"f_pplike":[{"option":"o_ppl1"},{"option":"o_ppl3"}],"f_ppagain":true,"f_ppnote":"Arrived a day early."}'::jsonb, now() - interval '16340 minutes' - interval '161541 milliseconds', now() - interval '16340 minutes', 161541, 'ES', 'mobile', 'Chrome', 'Arrived a day early.', '{"f_ppstar":8559,"f_pplike":7145,"f_ppagain":12961,"f_ppnote":4953}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000b004', '{"f_ppstar":3,"f_pplike":[{"option":"o_ppl2"},{"option":"o_other","other":"The gift note"}],"f_ppagain":true,"f_ppnote":"Sizing runs small."}'::jsonb, now() - interval '11650 minutes' - interval '40580 milliseconds', now() - interval '11650 minutes', 40580, 'GB', 'tablet', 'Safari', 'The gift note
Sizing runs small.', '{"f_ppstar":4090,"f_pplike":12638,"f_ppagain":3352,"f_ppnote":5746}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000b004', '{"f_ppstar":5,"f_pplike":[{"option":"o_ppl1"},{"option":"o_ppl2"},{"option":"o_ppl3"},{"option":"o_ppl4"}],"f_ppagain":true,"f_ppnote":"Best order so far."}'::jsonb, now() - interval '7920 minutes' - interval '169923 milliseconds', now() - interval '7920 minutes', 169923, 'CA', 'desktop', 'Edge', 'Best order so far.', '{"f_ppstar":4798,"f_pplike":8203,"f_ppagain":10622,"f_ppnote":10303}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000b004', '{"f_ppstar":1,"f_ppagain":false,"f_ppnote":"Still waiting for my refund."}'::jsonb, now() - interval '2940 minutes' - interval '116507 milliseconds', now() - interval '2940 minutes', 116507, 'US', 'mobile', 'Chrome', 'Still waiting for my refund.', '{"f_ppstar":3017,"f_ppagain":8060,"f_ppnote":2329}'::jsonb, NULL),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000a005', '{"f_wlemail":"sam@example.com","f_wlname":"Sam Rivera","f_wlsrc":{"option":"o_wls1"}}'::jsonb, now() - interval '83620 minutes' - interval '138377 milliseconds', now() - interval '83620 minutes', 138377, 'US', 'desktop', 'Chrome', 'sam@example.com
Sam Rivera', '{"f_wlemail":8397,"f_wlname":12279,"f_wlsrc":7186}'::jsonb, 'sam@example.com'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000a005', '{"f_wlemail":"katherine@example.com","f_wlname":"Katherine Johnson","f_wlsrc":{"option":"o_wls3"}}'::jsonb, now() - interval '75280 minutes' - interval '33004 milliseconds', now() - interval '75280 minutes', 33004, 'US', 'desktop', 'Safari', 'katherine@example.com
Katherine Johnson', '{"f_wlemail":8921,"f_wlname":11128,"f_wlsrc":13770}'::jsonb, 'katherine@example.com'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000a005', '{"f_wlemail":"lucas@example.com","f_wlsrc":{"option":"o_wls2"}}'::jsonb, now() - interval '64820 minutes' - interval '159419 milliseconds', now() - interval '64820 minutes', 159419, 'FR', 'mobile', 'Chrome', 'lucas@example.com', '{"f_wlemail":11582,"f_wlsrc":6202}'::jsonb, 'lucas@example.com'),
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000a005', '{"f_wlemail":"ravi@example.com","f_wlname":"Ravi Kumar","f_wlsrc":{"option":"o_wls4"}}'::jsonb, now() - interval '55520 minutes' - interval '61506 milliseconds', now() - interval '55520 minutes', 61506, 'IN', 'mobile', 'Chrome', 'ravi@example.com
Ravi Kumar', '{"f_wlemail":11789,"f_wlname":10776,"f_wlsrc":4449}'::jsonb, 'ravi@example.com'),
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000a005', '{"f_wlemail":"sofia@example.com","f_wlname":"Sofia Rossi"}'::jsonb, now() - interval '46130 minutes' - interval '70830 milliseconds', now() - interval '46130 minutes', 70830, 'IT', 'desktop', 'Firefox', 'sofia@example.com
Sofia Rossi', '{"f_wlemail":13693,"f_wlname":11332}'::jsonb, 'sofia@example.com')
ON CONFLICT DO NOTHING;

-- Consent answers carry the time they were given: the response's submit time.
UPDATE "responses" r SET "answers" = jsonb_set(r."answers", ARRAY[c.field_id, 'at'], to_jsonb(to_char(r."submitted_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
FROM (VALUES
  ('00000000-0000-4000-8000-000000000021', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000022', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000023', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000024', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000025', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000026', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000027', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000028', 'f_evcons'),
  ('00000000-0000-4000-8000-000000000029', 'f_evcons')
) AS c(id, field_id)
WHERE r."id" = c.id::uuid AND NOT (r."answers" -> c.field_id ? 'at');

-- Funnel counts per 15-minute bucket. Times move with now(), so this only runs for a form
-- that has none yet (running the seed again later adds nothing).
INSERT INTO "form_event_counts" ("form_id", "bucket", "views", "starts")
SELECT e.form_id::uuid, to_timestamp(floor(extract(epoch FROM now() - make_interval(mins => e.mins)) / 900) * 900), sum(e.views), sum(e.starts)
FROM (VALUES
  ('00000000-0000-4000-8000-00000000f001', 48930, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 48090, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 47760, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 47445, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 46785, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 46515, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 45840, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 45090, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 44670, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 43980, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 43305, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 43050, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 42285, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 41610, 2, 1),
  ('00000000-0000-4000-8000-00000000f001', 40860, 2, 1),
  ('00000000-0000-4000-8000-00000000f001', 40530, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 39795, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 39075, 2, 1),
  ('00000000-0000-4000-8000-00000000f001', 39030, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 38625, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 38115, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 37425, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 36930, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 36390, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 35715, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 35055, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 34770, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 34365, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 34065, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 33495, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 33225, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 32670, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 32130, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 31725, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 31425, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 30630, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 30390, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 29985, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 29460, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 29160, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 28755, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 28410, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 28065, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 27435, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 26850, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 26520, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 26445, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 25800, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 25290, 2, 1),
  ('00000000-0000-4000-8000-00000000f001', 24600, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 24330, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 23715, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 22950, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 22305, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 21780, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 20955, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 20385, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 19980, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 19305, 2, 1),
  ('00000000-0000-4000-8000-00000000f001', 18810, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 18675, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 17970, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 17145, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 16695, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 15885, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 15255, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 14805, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 14445, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 14100, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 13815, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 13260, 1, 2),
  ('00000000-0000-4000-8000-00000000f001', 12990, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 12570, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 11910, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 11280, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 10620, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 9810, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 9510, 2, 0),
  ('00000000-0000-4000-8000-00000000f001', 9045, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 8655, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 8520, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 7785, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 7455, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 6810, 4, 1),
  ('00000000-0000-4000-8000-00000000f001', 6015, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 5460, 1, 1),
  ('00000000-0000-4000-8000-00000000f001', 4830, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 4320, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 4095, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 3750, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 3210, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 2880, 2, 1),
  ('00000000-0000-4000-8000-00000000f001', 2550, 4, 0),
  ('00000000-0000-4000-8000-00000000f001', 1830, 2, 1),
  ('00000000-0000-4000-8000-00000000f001', 1815, 3, 1),
  ('00000000-0000-4000-8000-00000000f001', 1155, 1, 0),
  ('00000000-0000-4000-8000-00000000f001', 525, 3, 0),
  ('00000000-0000-4000-8000-00000000f001', 300, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 43170, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 42540, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 42255, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 41865, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 41310, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 40830, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 40470, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 40410, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 40155, 1, 1),
  ('00000000-0000-4000-8000-00000000f002', 39450, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 38895, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 38115, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 37380, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 36825, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 36690, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 36480, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 35745, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 35205, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 34680, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 34170, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 33615, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 33105, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 32310, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 31995, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 31365, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 30975, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 30270, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 30240, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 29430, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 28725, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 28335, 1, 1),
  ('00000000-0000-4000-8000-00000000f002', 27690, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 27225, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 26460, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 25815, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 25365, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 24990, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 24975, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 24255, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 23580, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 23295, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 22755, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 21915, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 21600, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 20925, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 20415, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 20160, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 19515, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 18930, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 18420, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 18030, 1, 1),
  ('00000000-0000-4000-8000-00000000f002', 17445, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 17025, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 16380, 1, 1),
  ('00000000-0000-4000-8000-00000000f002', 15915, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 15855, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 15600, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 14820, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 14055, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 13650, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 13350, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 12810, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 12420, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 12255, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 11805, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 11205, 3, 0),
  ('00000000-0000-4000-8000-00000000f002', 10590, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 9795, 1, 1),
  ('00000000-0000-4000-8000-00000000f002', 9450, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 9120, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 8775, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 8640, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 8415, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 7950, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 7545, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 6810, 1, 1),
  ('00000000-0000-4000-8000-00000000f002', 6525, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 5760, 1, 1),
  ('00000000-0000-4000-8000-00000000f002', 5715, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 5145, 4, 1),
  ('00000000-0000-4000-8000-00000000f002', 4890, 3, 1),
  ('00000000-0000-4000-8000-00000000f002', 4650, 1, 2),
  ('00000000-0000-4000-8000-00000000f002', 4530, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 3735, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 3375, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 2955, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 2235, 1, 0),
  ('00000000-0000-4000-8000-00000000f002', 1950, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 1440, 2, 1),
  ('00000000-0000-4000-8000-00000000f002', 1110, 2, 0),
  ('00000000-0000-4000-8000-00000000f002', 780, 4, 0),
  ('00000000-0000-4000-8000-00000000f002', 120, 1, 1),
  ('00000000-0000-4000-8000-00000000f003', 27330, 1, 0),
  ('00000000-0000-4000-8000-00000000f003', 27240, 1, 1),
  ('00000000-0000-4000-8000-00000000f003', 26640, 2, 1),
  ('00000000-0000-4000-8000-00000000f003', 26190, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 25965, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 25530, 2, 1),
  ('00000000-0000-4000-8000-00000000f003', 25035, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 24450, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 23850, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 23430, 1, 1),
  ('00000000-0000-4000-8000-00000000f003', 23190, 1, 0),
  ('00000000-0000-4000-8000-00000000f003', 22395, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 21975, 2, 1),
  ('00000000-0000-4000-8000-00000000f003', 21600, 1, 1),
  ('00000000-0000-4000-8000-00000000f003', 21555, 1, 1),
  ('00000000-0000-4000-8000-00000000f003', 21285, 2, 1),
  ('00000000-0000-4000-8000-00000000f003', 20925, 2, 0),
  ('00000000-0000-4000-8000-00000000f003', 20640, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 20085, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 19365, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 18915, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 18330, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 17970, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 17580, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 17115, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 16365, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 15840, 2, 0),
  ('00000000-0000-4000-8000-00000000f003', 15255, 1, 0),
  ('00000000-0000-4000-8000-00000000f003', 14625, 2, 0),
  ('00000000-0000-4000-8000-00000000f003', 14610, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 14235, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 13905, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 13545, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 12990, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 12255, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 11415, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 10995, 2, 0),
  ('00000000-0000-4000-8000-00000000f003', 10245, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 10110, 2, 2),
  ('00000000-0000-4000-8000-00000000f003', 9420, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 8625, 2, 0),
  ('00000000-0000-4000-8000-00000000f003', 7905, 3, 0),
  ('00000000-0000-4000-8000-00000000f003', 7215, 4, 1),
  ('00000000-0000-4000-8000-00000000f003', 6510, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 6360, 2, 2),
  ('00000000-0000-4000-8000-00000000f003', 5805, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 5040, 2, 1),
  ('00000000-0000-4000-8000-00000000f003', 4365, 1, 0),
  ('00000000-0000-4000-8000-00000000f003', 3555, 1, 0),
  ('00000000-0000-4000-8000-00000000f003', 2895, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 2595, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 1890, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 1380, 4, 0),
  ('00000000-0000-4000-8000-00000000f003', 1200, 2, 1),
  ('00000000-0000-4000-8000-00000000f003', 735, 3, 1),
  ('00000000-0000-4000-8000-00000000f003', 150, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 37410, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 36900, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 36300, 7, 2),
  ('00000000-0000-4000-8000-00000000f004', 35940, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 35460, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 34905, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 34605, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 34260, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 33435, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 33195, 3, 2),
  ('00000000-0000-4000-8000-00000000f004', 33135, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 32550, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 32100, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 31575, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 31275, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 30945, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 30630, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 30360, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 29745, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 29445, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 29400, 1, 2),
  ('00000000-0000-4000-8000-00000000f004', 28680, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 28305, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 27990, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 27705, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 27105, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 26820, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 26070, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 25665, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 25140, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 24480, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 23670, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 23265, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 22500, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 21855, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 21645, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 21510, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 21045, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 20565, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 20280, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 19965, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 19650, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 19170, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 18900, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 18480, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 17985, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 17505, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 17085, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 16770, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 16335, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 16260, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 15735, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 15360, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 14700, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 14055, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 13380, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 12660, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 12075, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 11640, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 11340, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 11010, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 10635, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 10260, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 9990, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 9435, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 8715, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 7965, 3, 0),
  ('00000000-0000-4000-8000-00000000f004', 7920, 1, 2),
  ('00000000-0000-4000-8000-00000000f004', 7665, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 7080, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 6405, 3, 1),
  ('00000000-0000-4000-8000-00000000f004', 6030, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 5685, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 4965, 2, 0),
  ('00000000-0000-4000-8000-00000000f004', 4635, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 4335, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 3795, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 3360, 4, 1),
  ('00000000-0000-4000-8000-00000000f004', 2940, 1, 1),
  ('00000000-0000-4000-8000-00000000f004', 2850, 2, 1),
  ('00000000-0000-4000-8000-00000000f004', 2400, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 1755, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 1410, 4, 0),
  ('00000000-0000-4000-8000-00000000f004', 645, 1, 0),
  ('00000000-0000-4000-8000-00000000f004', 360, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 84930, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 84135, 4, 1),
  ('00000000-0000-4000-8000-00000000f005', 83610, 1, 1),
  ('00000000-0000-4000-8000-00000000f005', 83385, 3, 1),
  ('00000000-0000-4000-8000-00000000f005', 83010, 1, 1),
  ('00000000-0000-4000-8000-00000000f005', 82725, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 82035, 2, 1),
  ('00000000-0000-4000-8000-00000000f005', 81585, 3, 1),
  ('00000000-0000-4000-8000-00000000f005', 81255, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 80445, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 79755, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 79320, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 78480, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 77880, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 77040, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 76215, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 75765, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 75300, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 75270, 3, 1),
  ('00000000-0000-4000-8000-00000000f005', 74955, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 74445, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 74055, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 73275, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 72765, 4, 1),
  ('00000000-0000-4000-8000-00000000f005', 72510, 3, 1),
  ('00000000-0000-4000-8000-00000000f005', 71685, 4, 1),
  ('00000000-0000-4000-8000-00000000f005', 71055, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 70800, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 69975, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 69615, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 68940, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 68385, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 67725, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 67020, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 66660, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 66300, 2, 1),
  ('00000000-0000-4000-8000-00000000f005', 65640, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 65280, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 64815, 1, 1),
  ('00000000-0000-4000-8000-00000000f005', 64560, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 64155, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 63420, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 62925, 4, 1),
  ('00000000-0000-4000-8000-00000000f005', 62445, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 62130, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 61635, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 60915, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 60510, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 60255, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 59955, 3, 1),
  ('00000000-0000-4000-8000-00000000f005', 59295, 3, 1),
  ('00000000-0000-4000-8000-00000000f005', 58530, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 58095, 1, 1),
  ('00000000-0000-4000-8000-00000000f005', 57465, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 56925, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 56415, 1, 1),
  ('00000000-0000-4000-8000-00000000f005', 55650, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 55515, 3, 1),
  ('00000000-0000-4000-8000-00000000f005', 55095, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 54270, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 53970, 4, 0),
  ('00000000-0000-4000-8000-00000000f005', 53445, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 52680, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 52110, 4, 1),
  ('00000000-0000-4000-8000-00000000f005', 51375, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 50745, 2, 1),
  ('00000000-0000-4000-8000-00000000f005', 50385, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 50100, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 49530, 4, 1),
  ('00000000-0000-4000-8000-00000000f005', 49095, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 48540, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 48090, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 47700, 3, 0),
  ('00000000-0000-4000-8000-00000000f005', 47010, 2, 0),
  ('00000000-0000-4000-8000-00000000f005', 46275, 2, 1),
  ('00000000-0000-4000-8000-00000000f005', 46125, 2, 2),
  ('00000000-0000-4000-8000-00000000f005', 45780, 1, 0),
  ('00000000-0000-4000-8000-00000000f005', 45420, 1, 1),
  ('00000000-0000-4000-8000-00000000f005', 44805, 4, 1)
) AS e(form_id, mins, views, starts)
WHERE NOT EXISTS (SELECT 1 FROM "form_event_counts" x WHERE x."form_id" = e.form_id::uuid)
GROUP BY 1, 2
ON CONFLICT DO NOTHING;

-- A theme saved from the theme editor.
INSERT INTO "themes" ("id", "name", "settings", "created_at", "updated_at") VALUES
  ('00000000-0000-4000-8000-0000000000c1', 'Brand: night', '{"preset":"midnight","colors":{"background":"#12101F","question":"#F2F0FF","answer":"#A897FF","button":"#A897FF","buttonText":"#15112E"},"font":"Manrope","questionFont":null,"fontSize":"m","background":{"type":"solid"},"logo":null,"buttonRadius":"rounded","alignment":"left"}'::jsonb, now() - interval '21600 minutes', now() - interval '21600 minutes')
ON CONFLICT DO NOTHING;

-- The counters the forms list reads, from the rows above.
UPDATE "forms" f SET "response_count" = s.n, "last_response_at" = s.last
FROM (
  SELECT fo."id", count(r."id")::int AS n, max(r."submitted_at") AS last
  FROM "forms" fo LEFT JOIN "responses" r ON r."form_id" = fo."id"
  WHERE fo."id" IN ('00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-00000000f003', '00000000-0000-4000-8000-00000000f004', '00000000-0000-4000-8000-00000000f005', '00000000-0000-4000-8000-00000000f006')
  GROUP BY fo."id"
) AS s
WHERE f."id" = s."id" AND (f."response_count" <> s.n OR f."last_response_at" IS DISTINCT FROM s.last);

-- All-time starts (forms.starts_total), from the 15-minute rollup above.
UPDATE "forms" f SET "starts_total" = e.n
FROM (SELECT "form_id", sum("starts")::int AS n FROM "form_event_counts" GROUP BY "form_id") AS e
WHERE f."id" = e."form_id" AND f."starts_total" <> e.n;

-- The exact counters live in form_counts (responses come from the insert trigger); starts go into
-- shard 0, minus any other shard's, so running this twice keeps the same total.
INSERT INTO "form_counts" ("form_id", "shard")
SELECT DISTINCT e."form_id", 0 FROM "form_event_counts" e
WHERE EXISTS (SELECT 1 FROM "forms" f WHERE f."id" = e."form_id")
ON CONFLICT DO NOTHING;
UPDATE "form_counts" fc SET "starts" = e.n - (
  SELECT coalesce(sum(o."starts"), 0) FROM "form_counts" o WHERE o."form_id" = fc."form_id" AND o."shard" <> 0
)
FROM (SELECT "form_id", sum("starts")::int AS n FROM "form_event_counts" GROUP BY "form_id") AS e
WHERE fc."form_id" = e."form_id" AND fc."shard" = 0;

COMMIT;
