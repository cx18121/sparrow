# Sparrow

Sparrow is a student cold-outreach workspace. Users build campaigns, pull batches of startup leads, find contacts, generate or edit email drafts, and send reviewed drafts through their own Gmail account.

The app is campaign-first: Home shows campaign-level next actions, Templates is the reusable email library, Settings holds sender/profile/sending/account setup, and each Campaign owns its Leads, Drafts, Sent log, and Campaign Settings.

## Language

**Company**:
A shared startup/company record in the global pool. It carries source metadata, tags, stage, region, hiring flag, and optional cached research dossier. Companies are shared across users.
_Avoid_: Lead, prospect

**Contact**:
A shared, company-scoped person record: name, email, title, LinkedIn, and source. Contacts belong to Companies, not individual users. Apollo preview contacts may exist with `email = null` until a reveal is paid for.
_Avoid_: Lead (a Contact is the person record; a Lead is the user's saved relationship to a Company/Contact)

**Lead**:
A user's saved outreach target for a Company and, optionally, one Contact. Represented by `UserLead` as `(user, company, contact?)`, with an optional Apollo person id used for later reveal.
_Avoid_: Company, Contact, prospect

**Custom Contact**:
A user-owned recipient added manually, with optional company name but no Company row. Used for out-of-pipeline outreach such as warm intros, referrals, or conference connections. Custom Contacts can belong to Campaigns and can receive Drafts/Sent emails without Apollo enrichment.
_Avoid_: Contact (shared company contact), Lead (company-backed user target)

**Campaign**:
A user-configured outreach workspace with filters, template, attachments, batch size, status, and membership. Campaigns produce batches of Leads and can also include Custom Contacts. Campaigns do not auto-send; users review drafts and send manually.
_Avoid_: Sequence, drip, automation

**Batch**:
A numbered group of Leads generated for a Campaign at one point in time. New batches exclude companies already seen by the Campaign and, by default, companies the user already saved elsewhere. `includePreviouslySaved` opts a Campaign out of the cross-campaign dedup rule.
_Avoid_: Send, wave

**Draft**:
An `Email` row with `status = "draft"`, prepared for one Lead or Custom Contact. Users can preview, edit, save, and later send it. Sent emails use the same `Email` model with `status = "sent"` and `sentAt`.
_Avoid_: Message (too generic)

**Template**:
A reusable subject/body skeleton with merge tags. New templates default to `verbatim = true`: Sparrow substitutes merge tags and AI-derived `{{feature_line}}` / `{{fit_angle}}` values, then sends the authored wording without a Claude rewrite. If `verbatim = false`, Sparrow substitutes tags first, then Claude rewrites the body using the skeleton as structure and intent. The subject is always template-driven.
_Avoid_: Prompt, style guide

**Profile**:
The sender setup used for drafting. It includes sender name, organization, role, resume/background text, resume file metadata, default template, send limits, and attachment library in `workspaceConfig`; Gmail and host-generation capability are exposed separately on `/api/profile` as `hasGoogleRefreshToken` and `hasClaudeKey`.
_Avoid_: Account (Account is the Settings tab for sign-out/Gmail/delete actions)

**Personalization Dossier**:
Cached per-Company research stored on `Company.researchDossier`. Production retrieval is Exa-first with Tavily fallback only when Exa returns zero usable results. `pickFitAngle` runs per user on top of the shared dossier and resume text to choose a `featureLine` and `fitAngle`.
_Avoid_: Lead enrichment (that refers to finding people/emails)

## Lead Status Lifecycle

`LeadStatus` is shared by `UserLead` and `CustomContact`.

- `SAVED` — available for drafting or future outreach
- `EMAILED` — an email was sent
- `NO_RESPONSE` — emailed, no reply received; follow-up can still be appropriate
- `DECLINED` — recipient explicitly opted out or declined; do not contact again

There is no `NEW` status in the active schema. There is no `REJECTED` status; use `NO_RESPONSE` or `DECLINED` depending on meaning.

## Relationships

- A **Company** has many shared **Contacts**
- A **User** has many **Leads**; each **Lead** belongs to one **Company** and optionally one **Contact**
- A **User** has many **Custom Contacts**; each can belong to zero or more **Campaigns**
- A **Campaign** belongs to one **User**, has optional **Template** and attachments, and produces many **Batches** through `CampaignLead`
- A **Draft** belongs either to a **Lead** or a **Custom Contact**
- A **Template** belongs to one **User**; `isShared` exists for legacy/library compatibility but ordinary user templates are isolated

## Example Dialogue

> **Dev:** "When a user launches a Campaign, do we immediately email everyone?"
> **Domain expert:** "No. The Campaign creates a Batch of Leads, drafts are generated for review, and the user sends manually from Drafts."

> **Dev:** "What if the user wants to contact someone they met at a conference?"
> **Domain expert:** "That's a Custom Contact. It skips Company and Apollo enrichment, but can still be added to a Campaign and drafted."

> **Dev:** "Does a Template always get rewritten by Claude?"
> **Domain expert:** "No. New Templates are verbatim by default. Claude rewrites only when the template's verbatim toggle is off."

> **Dev:** "A lead replied saying they're not interested. What status?"
> **Domain expert:** "`DECLINED`. If they just never replied, it's `NO_RESPONSE`."

## Flagged Ambiguities

- `Company.headcount` still exists and ingestion scripts may write it, but the user-facing audience filter no longer uses headcount.
- `Template.isShared` exists in the schema. User templates should remain private unless a deliberate shared-library feature is being handled.
- Cached company dossiers have a 150-day freshness TTL (`DOSSIER_TTL_MS` + `slotIsFresh` in `server/lib/draft-generation.ts`). Older slots are treated as cache-miss and re-researched on demand the next time a draft is generated for that company. There is no background refresh and no per-company override. See ADR-0007.
