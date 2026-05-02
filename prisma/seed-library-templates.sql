INSERT INTO "Template" (id, "userId", name, subject, body, "isShared", "createdAt", "updatedAt") VALUES
(
  'lib_warm_intro',
  '__library__',
  'Warm Intro',
  'a thought on {{company}}',
  '<p>Hi {{first_name}},</p><p>Saw that {{company}} recently [launched / raised / shipped X] — the approach stood out to me.</p><p>I''m {{sender_name}}, a CS student at Cornell following this space closely. No ask — just wanted to connect. Happy to share what I''ve been building if it''s ever useful.</p>',
  true,
  now(),
  now()
),
(
  'lib_direct_ask',
  '__library__',
  'Direct Ask',
  '{{first_name}} — 15 min this week?',
  '<p>Hi {{first_name}},</p><p>I''m {{sender_name}}, a Cornell CS junior. I''ve been building in [relevant area] and {{company}}''s work on [specific thing] is directly relevant to what I''m learning.</p><p>Would you be open to a 15-minute call this week? I have specific questions and won''t waste your time.</p>',
  true,
  now(),
  now()
),
(
  'lib_coffee_chat',
  '__library__',
  'Coffee Chat',
  'quick question about {{company}}',
  '<p>Hi {{first_name}},</p><p>I came across {{company}} through [specific source] and your approach to [specific thing] genuinely caught my attention.</p><p>I''m {{sender_name}}, a Cornell student working on [related thing]. Would a 15-minute Zoom make sense? No pitch — just curious how you think about [one specific question].</p>',
  true,
  now(),
  now()
),
(
  'lib_recruiting',
  '__library__',
  'Recruiting Outreach',
  '{{company}} — internship interest',
  '<p>Hi {{first_name}},</p><p>I''m {{sender_name}}, a Cornell CS junior. I''ve been following {{company}} since [specific moment] and wanted to reach out directly.</p><p>I [built X / shipped Y / contributed to Z] — happy to share details. Would a 15-minute call make sense to see if there''s a fit?</p>',
  true,
  now(),
  now()
),
(
  'lib_follow_up',
  '__library__',
  'Follow-up',
  'Re: {{company}}',
  '<p>Hi {{first_name}},</p><p>Wanted to resurface this in case it got buried.</p><p>Since I last wrote, I [did one new relevant thing — shipped something, read their latest post, found a connection point]. Still very interested — 15 minutes whenever works for you.</p><p>{{sender_name}}</p>',
  true,
  now(),
  now()
),
(
  'lib_research',
  '__library__',
  'Research Interview',
  'one question about {{company}}',
  '<p>Hi {{first_name}},</p><p>I''m {{sender_name}}, a Cornell student researching how early-stage teams approach [specific topic]. {{company}}''s work on [specific thing] is one of the clearest examples I''ve found.</p><p>Would you be open to 15 minutes? One focused question — happy to share my findings afterward.</p>',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  "updatedAt" = now();
