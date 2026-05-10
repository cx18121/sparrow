-- Library templates surfaced to every user via the templates list endpoint.
--
-- Design rules:
--   * Render a complete, send-ready email using ONLY merge tags that
--     server/lib/ai/generate-email.ts substitutes. Anything else inside
--     {{...}} leaks to the recipient as literal text.
--   * No em-dashes. They read as an AI tell. Use periods, colons,
--     parentheses, or restructure.
--   * No [bracketed placeholders]. They look like unparsed variables to
--     users; library templates must send cleanly as-is. Self-intro
--     framing ("a Cornell CS junior") stays as static text since it's
--     the same every send. Users clone and edit to match their own.
--
-- Supported merge tags:
--   {{first_name}}, {{last_name}}, {{company}}, {{role}} (recipient),
--   {{sender_name}}, {{feature_line}} (AI-derived company fragment),
--   {{fit_angle}} (AI-derived sender-fit fragment).
--
-- Paragraph-drop rule (generate-email.ts:96-105): any paragraph
-- containing {{feature_line}} or {{fit_angle}} is dropped at draft time
-- if that AI field comes back empty for the recipient. Structure each
-- template so the greeting, self-intro, and ask sit in their own static
-- paragraphs and remain coherent when the AI-personalized paragraphs
-- vanish.
--
-- Pattern sources (publicly-shared cold-outreach templates whose
-- senders report having personally used them):
--   * lib_warm_intro      Tristan Walker / FourSquare (per colinkeeley.com)
--   * lib_follow_up       Plain "bump" pattern (Close.com benchmarks
--                         show short follow-ups out-reply long ones)
--   * lib_built_something Tristan Walker + Alessa Massa / Morning Brew
--   * lib_role_interest   Eli Kamerow's "Intro" framing (Medium:
--                         "cold emailing for startup interviews")

-- Remove stale library templates (renames + cuts) so the library matches
-- this seed exactly. Personal templates (any non-__library__ userId) are
-- untouched.
DELETE FROM "Template"
WHERE "userId" = '__library__'
  AND id NOT IN (
    'lib_warm_intro',
    'lib_follow_up',
    'lib_built_something',
    'lib_role_interest'
  );

INSERT INTO "Template" (id, "userId", name, subject, body, "isShared", "createdAt", "updatedAt") VALUES
(
  'lib_warm_intro',
  '__library__',
  'Warm intro',
  'quick thought on {{company}}',
  '<p>Hi {{first_name}},</p><p>{{feature_line}} caught my attention and I figured I''d reach out.</p><p>{{fit_angle}} is what I''ve been heads-down on lately, which feels like a real overlap.</p><p>I''m {{sender_name}}, a Cornell CS junior. Any chance you''d have 15 minutes in the next couple weeks?</p>',
  true,
  now(),
  now()
),
(
  'lib_follow_up',
  '__library__',
  'Follow-up',
  'Re: {{company}}',
  '<p>Hi {{first_name}},</p><p>Bumping this up in case it got lost.</p><p>{{fit_angle}} is still where most of my time goes, and {{company}}''s work feels even more relevant now than when I first wrote.</p><p>15 minutes whenever works for you.</p><p>{{sender_name}}</p>',
  true,
  now(),
  now()
),
(
  'lib_built_something',
  '__library__',
  'Show what you built',
  'built something adjacent to {{company}}',
  '<p>Hi {{first_name}},</p><p>Recently I shipped {{fit_angle}}.</p><p>I''m emailing you specifically because it sits right next to {{feature_line}}, and your reaction would mean more than anyone else''s.</p><p>I''m {{sender_name}}, a Cornell CS junior. Not asking for a job. Just curious what you''d push back on.</p><p>15 minutes whenever works.</p>',
  true,
  now(),
  now()
),
(
  'lib_role_interest',
  '__library__',
  'Role interest',
  'quick intro about {{company}}',
  '<p>Hi {{first_name}},</p><p>{{feature_line}} is the kind of work I''d want to be close to, which is why I''m emailing.</p><p>{{fit_angle}} is where my time goes.</p><p>I''m {{sender_name}}, a Cornell CS junior, and I''d love to hear if there''s any opening at {{company}} where someone like me could be useful. Would 15 minutes this week or next make sense?</p>',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  "updatedAt" = now();
