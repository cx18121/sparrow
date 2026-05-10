# Requirements: Sparrow

**Updated:** 2026-05-05  
**Core value:** Campaign-first cold outreach for students, from startup/contact discovery to reviewed Gmail-sent drafts.

## Current v1 Requirements

### Authentication And Setup

- [x] **AUTH-01**: User can sign up/sign in with email and password.
- [x] **AUTH-02**: User can sign in with Google OAuth.
- [x] **AUTH-03**: User session persists across refresh.
- [x] **AUTH-04**: Google sign-in requests identity and `gmail.send` scopes in one consent flow.
- [x] **AUTH-05**: Settings Account tab can start a manual Gmail reconnect flow.

### Onboarding And Settings

- [x] **SETUP-01**: User can enter sender name, organization, and role.
- [x] **SETUP-02**: User can paste resume/background text.
- [x] **SETUP-03**: User can upload PDF, DOCX, or TXT resume/bio and extract text client-side.
- [x] **SETUP-04**: User can choose a default template.
- [x] **SETUP-05**: User can configure daily send limit and delay between sends.
- [x] **SETUP-06**: User can maintain a reusable attachment library.
- [x] **SETUP-07**: Settings has exactly three tabs: Profile, Sending, Account.
- [x] **SETUP-08**: BYO Claude key, signature, time zone, Style tab, and Integrations tab are retired.

### Campaigns And Audience

- [x] **CAMP-01**: User can create campaigns through a full-screen wizard.
- [x] **CAMP-02**: User can filter audience by region, stage, YC batch, hiring, and namespaced tags.
- [x] **CAMP-03**: Headcount is not exposed as an audience filter.
- [x] **CAMP-04**: YC batch picker appears only when YC-backed signal is selected.
- [x] **CAMP-05**: Audience previews sample randomly rather than alphabetically.
- [x] **CAMP-06**: Campaigns support Active, Paused, and Completed states in the UI.
- [x] **CAMP-07**: Campaigns can exclude previously saved companies by default, with an opt-in include toggle.
- [x] **CAMP-08**: Campaign workspace exposes Overview, Leads, Drafts, Sent, Settings.

### Discovery And Contacts

- [x] **DISC-01**: App maintains a shared verified company pool.
- [x] **DISC-02**: User can save company-backed Leads into a Campaign.
- [x] **DISC-03**: User can add Custom Contacts that bypass the Company/Contact pipeline.
- [x] **DISC-04**: Apollo contact search returns previews for a Company.
- [x] **DISC-05**: Apollo reveal persists Contacts and consumes paid reveal credits only through explicit reveal flows/scripts.
- [x] **DISC-06**: When Apollo senior-title search returns zero, server retries without title filter and reports `usedFallback`.

### Templates And Drafting

- [x] **TMPL-01**: User can create, edit, duplicate, delete, search, and preview Templates.
- [x] **TMPL-02**: Templates support merge tags including `{{first_name}}`, `{{company}}`, `{{sender_name}}`, `{{feature_line}}`, and `{{fit_angle}}`.
- [x] **TMPL-03**: New Templates default to verbatim mode.
- [x] **TMPL-04**: User can opt a Template into AI rewrite mode.
- [x] **DRAFT-01**: User can generate Drafts for Leads and Custom Contacts.
- [x] **DRAFT-02**: Company-backed Drafts use cached/researched company dossier plus per-user resume fit-angle picking.
- [x] **DRAFT-03**: Custom Contact drafts skip company dossier research.
- [x] **DRAFT-04**: Drafts are editable before sending.
- [x] **DRAFT-05**: Saved Drafts can include selected attachments.

### Sending And Tracking

- [x] **SEND-01**: User can send saved Drafts through connected Gmail.
- [x] **SEND-02**: App enforces daily send limit and delay between sends.
- [x] **SEND-03**: Sent emails update Email status and mark the target Lead/Custom Contact as EMAILED.
- [x] **TRACK-01**: User can view draft and sent email lists.
- [x] **TRACK-02**: Lead/Custom Contact status vocabulary is SAVED, EMAILED, NO_RESPONSE, DECLINED.

## Deferred / Future

- [ ] **FUTURE-01**: Reply detection.
- [ ] **FUTURE-02**: Follow-up reminders and follow-up draft generation.
- [ ] **FUTURE-03**: Scheduled sends.
- [ ] **FUTURE-04**: Password reset.
- [ ] **FUTURE-05**: Analytics such as open/reply rates, if privacy and deliverability tradeoffs are revisited.
- [ ] **FUTURE-06**: Shared template/library marketplace beyond existing legacy/library compatibility fields.

## Explicitly Removed

- Per-user Claude keys.
- Per-user Apollo key storage.
- Product Hunt as a required v1 source.
- Headcount audience filter.
- `NEW` and `REJECTED` lead statuses.
- CAN-SPAM footer/unsubscribe automation in the current app.
- Auto reply detection.
- BullMQ/Redis worker deployment.

---
*Last updated: 2026-05-05*
