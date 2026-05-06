# v2 Spec: Reply Detection + Open Tracking

**Branch:** `v2/reply-detection`
**Status:** Draft for review
**Owner:** charlie

---

## Goal

Close the v1 feedback loop. Today Sparrow ends at "sent." The user has no signal — in the app — for whether a recipient opened the email or replied. Both are gateways to every other v2 feature (follow-up sequences, analytics, prompt iteration based on what actually converts).

**Success criteria:**
1. When a recipient replies to a sent email, the corresponding `Email` row flips to `replied` within 60 seconds and the workspace Sent tab shows it.
2. When a recipient opens an email (caveats below), the row's `openedAt` updates and the UI surfaces it.
3. Reply classification distinguishes meaningful replies from auto-responders / OOO / bounces.
4. Existing users get a clear path to enable the feature (re-consent flow), and the absence of consent doesn't break sending.

**Out of scope for this branch:**
- Follow-up sequences (separate branch, depends on this).
- Analytics dashboard joining replies to fit-angles (separate branch, depends on this).
- Reply-aware draft generation (later branch).

---

## Open tracking — honest scope

**Ship it, but flag the data is partial.** Real-world reliability:

- **Gmail recipients:** Google pre-fetches the tracking pixel server-side and caches it. Result: every Gmail recipient registers as "opened" on delivery, then real opens never re-fire because Gmail serves the cached image.
- **Apple Mail (iOS 15+, macOS 12+):** Mail Privacy Protection pre-fetches all remote images. Same pattern — looks like opened, may not be.
- **Outlook desktop:** sometimes blocks images by default. Looks like never opened, may have been.

**What this means:**
- Show open status in the UI with a tooltip caveat ("Many email clients pre-fetch images — opens are an estimate").
- **Do not drive automated logic off opens** (e.g. don't auto-follow-up based on "didn't open"). Reply state is the only signal trustworthy enough for automation.

### Implementation
- `<img src="https://api.usesparrow.dev/track/o/<emailId>.png" width="1" height="1" />` injected into HTML body at send time.
- New route `/api/track/o/[emailId].png`:
  - Returns a 1x1 transparent GIF immediately (`Cache-Control: no-store` to disable downstream caching where possible — though Gmail will still proxy-cache).
  - Fire-and-forget UPDATE of `Email.openedAt = now()` (first hit only) and increment `Email.openCount`.
- Pixel only injected on real sends, never on send-test or draft preview.

---

## Reply detection — architecture decisions

### 1. Pub/Sub push vs polling

**Recommendation: Pub/Sub push.**

| | Pub/Sub push | Polling (cron + history.list) |
|---|---|---|
| Latency | <60s | 1–5min depending on cron cadence |
| Setup cost | GCP topic + IAM grants + webhook auth | None beyond existing Vercel cron |
| Reliability | Google retries; webhook signature verification needed | Simple, but per-user cron N+1 |
| Quota | Cheap (push only on changes) | Burns quota even on idle inboxes |
| Watch renewal | Watch expires in 7 days, must renew | No equivalent — but historyId can drift past 30d retention |

Polling looks simpler but its weakest point is *quota*. `users.history.list` per user, every few minutes, for users with no activity, is wasted calls. Push fires only when something changes.

**Webhook security:** Gmail Pub/Sub messages are wrapped in an OIDC token from Google's signing key. Verify on every webhook hit before doing any work — without that, anyone with our endpoint URL can spoof reply events.

### 2. Watch renewal

Gmail Watch expires after 7 days. Need a daily cron (Vercel Cron) that renews any watch whose `gmailWatchExpiry < now() + 24h`. Skip users who never connected.

### 3. Capturing messageId + threadId at send time

**Prerequisite for everything.** Today `server/lib/send-draft.ts:182` calls `gmail.users.messages.send` and discards the response. The response includes `id` (messageId) and `threadId` — both required to map an inbound reply back to a sent Email row.

This is a small, prerequisite change that ships first.

### 4. Reply classification

When a new message arrives in a thread we sent, fetch it, classify with Haiku. Categories:

- `REPLY` — meaningful human response (positive, scheduling, soft-no, hard-no — all count as replies for the dashboard, sub-classification deferred)
- `AUTO_REPLY` — vacation, OOO, "I'm out until X", auto-responders
- `BOUNCE` — delivery failure (`mailer-daemon@`, "Address not found")
- `OTHER` — re-routes, non-substantive forwards

Sub-classification of REPLY (positive / soft-no / hard-no) is a separate v2 feature that the workspace inbox triage uses — out of scope here.

Why Haiku and not regex: bounces are easy to regex-match (sender domain, common phrases), but the OOO vs real-reply line is fuzzy in practice (real reply sometimes opens with "I'm OOO until Friday but…"). Haiku gets it right ~99%.

### 5. Schema additions

```prisma
model Email {
  // ... existing fields
  gmailMessageId       String?     // captured at send time
  gmailThreadId        String?     // captured at send time
  openedAt             DateTime?   // first pixel hit
  openCount            Int         @default(0)
  repliedAt            DateTime?
  replyMessageId       String?     // Gmail message ID of the reply
  replyFrom            String?     // sender of the reply
  replyClassification  String?     // REPLY | AUTO_REPLY | BOUNCE | OTHER

  @@index([gmailThreadId])         // hot path: webhook lookups by threadId
}

model UserGmailWatch {              // new — one row per connected user
  userId           String   @id
  watchExpiry      DateTime
  historyId        String              // last processed historyId
  pubsubTopic      String              // for renewal
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

`UserLead.status` flow remains: `SAVED → EMAILED → RESPONDED` (or `NO_RESPONSE` after a configurable window — that's a follow-up-sequences concern, leave for now).

### 6. Gmail OAuth scope changes

Current scope: `gmail.send`. Reply detection needs additional scopes — minimum viable is:

- `https://www.googleapis.com/auth/gmail.readonly` — to fetch reply messages and run history.list.
- `https://www.googleapis.com/auth/gmail.metadata` is *not* enough — we need bodies for classification.

Better: scope down to the per-message `gmail.modify` scope only on threads we sent? Gmail doesn't support per-thread scope, so `gmail.readonly` is the minimum.

**Re-consent UX:**
- Existing users: `provider_refresh_token` was minted with `gmail.send` only. Adding scopes invalidates it; users must re-consent.
- Surface as a banner in the workspace: *"Enable reply tracking — reconnect Gmail (one click)"*. The button drops them through `/api/google/connect` with the new scope set and `prompt=consent`.
- Until reconsent, reply detection silently skips that user — sending still works on the old scope.
- New users get the new scope set on initial sign-in (one consent screen, not two).

### 7. Webhook handler shape

Route: `/api/webhooks/gmail` (POST).

```
1. Verify the OIDC token in the Authorization header (Google signing key, audience = our project).
2. Parse the Pub/Sub message — contains userEmail + historyId.
3. Resolve userId from userEmail (look up user_profiles by email).
4. Run gmail.users.history.list(startHistoryId = stored historyId).
5. For each new message, check if its threadId matches any Email.gmailThreadId for this user.
6. If yes:
     a. Fetch the message
     b. Skip if From is the user themselves (own send shows up here too)
     c. Classify with Haiku
     d. Update the Email row
7. Update UserGmailWatch.historyId.
```

Idempotency: process each new messageId at most once. Use `replyMessageId` uniqueness on Email plus an INSERT-skip-on-conflict pattern.

### 8. UI changes

**Workspace → Sent tab:**
- Each row gets a small replied/opened indicator. Replied = forest green dot + "Replied". Opened-only = warm tan dot + "Opened" (with the caveat tooltip).
- New filter chip: "Replied" / "No reply yet" / "All".
- Bounced rows show a danger-tone pill instead — important so the user knows the email never landed.

**Workspace → Drafts/Leads tabs:**
- `UserLead.status === RESPONDED` automatically excludes from new-batch generation (we already filter against existing leads, but RESPONDED specifically should never re-target).

**Home / campaign card:**
- The leads/drafts/sent strip we just shipped grows to leads/drafts/sent/replies once data is flowing. Render the 4th stat conditionally so brand-new campaigns don't show "0 replies."

---

## Phased rollout

This is a big surface. Slice into commits that each ship behind a feature flag (or env-gated) so we can roll forward and roll back independently:

1. **Capture-only** — modify `send-draft.ts` to persist `gmailMessageId` + `gmailThreadId` on Email. Schema migration. No UX. Ships safely; existing flows unaffected.
2. **Open tracking** — pixel injection at send + `/api/track/o/[id].png` route + UI badge with caveat tooltip. Ships independently of replies.
3. **Reply detection — capture path** — add scope to OAuth, build `/api/google/connect` flow with re-consent banner. New users land on new scope automatically. Existing users see the banner.
4. **Reply detection — Pub/Sub** — GCP setup, watch creation, webhook handler, classification. Cron for watch renewal.
5. **UI** — Sent tab indicators, filter chips, campaign card 4th stat.

Each phase = a separate atomic commit on this branch, shipping to production via the existing Vercel auto-deploy.

---

## Open questions for review

1. **Pub/Sub vs polling — am I right to push for Pub/Sub?** Polling is simpler. If we expect ≤ a few hundred connected users in v2, polling might be fine and avoids GCP entirely.
2. **Reply classification — Haiku per inbound message, or regex-first with Haiku as a tiebreaker?** Haiku-everywhere is simple but ~$0.0003 per inbound message, which adds up if students get a lot of inbox noise.
3. **Should `Email.openedAt` reset/track multi-open?** Right now I'm proposing first-hit only with a count. Some tools track *last* open instead. Pick one before implementing.
4. **Tracking-pixel privacy disclosure.** Do we want to add a quiet line in the email signature ("This email may include tracking — reply STOP to opt out") or skip it? Most outbound tools skip it; ethically, disclosure is the higher path. Worth deciding before ship.
5. **Re-consent banner copy.** What's the friction-minimizing message? Probably *"Enable reply tracking · Reconnect Gmail"* with a one-line helper.

---

## Dependencies

- Google Cloud project for Pub/Sub topic + IAM grants. Existing Sparrow GCP project should be fine.
- New env vars: `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`, `GMAIL_WEBHOOK_AUDIENCE`.
- Vercel Cron for daily watch-renewal job.
