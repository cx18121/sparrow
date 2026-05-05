import { beforeEach, describe, expect, it } from 'vitest'
import {
  draftQueueCacheKey,
  readCampaignMembersCache,
  readDraftQueueCache,
  writeCampaignMembersCache,
  writeDraftQueueCache,
} from '../../src/lib/workspaceCache'
import type { CampaignMembers } from '../../src/lib/api'
import type { Email } from '../../src/types/api'

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }

  clear() {
    this.store.clear()
  }
}

describe('workspace cache helpers', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    })
  })

  it('scopes draft queue caches by user, campaign, and tab', () => {
    expect(draftQueueCacheKey('user-1', 'draft', 'campaign-1')).toBe('cf_email_cache_user-1_campaign_campaign-1_draft')
    expect(draftQueueCacheKey('user-1', 'draft', 'campaign-2')).toBe('cf_email_cache_user-1_campaign_campaign-2_draft')
    expect(draftQueueCacheKey('user-1', 'draft')).toBe('cf_email_cache_user-1_global_draft')
    expect(draftQueueCacheKey(null, 'draft', 'campaign-1')).toBeNull()
  })

  it('round trips campaign members and draft queues', () => {
    const members = { items: [{ id: 'lead-1' }], customContacts: [] } as CampaignMembers
    const drafts = [{ id: 'email-1', status: 'draft' }] as Email[]

    writeCampaignMembersCache('campaign-1', members)
    writeDraftQueueCache('user-1', 'draft', drafts, 'campaign-1')

    expect(readCampaignMembersCache('campaign-1')).toEqual(members)
    expect(readDraftQueueCache('user-1', 'draft', 'campaign-1')).toEqual(drafts)
    expect(readDraftQueueCache('user-1', 'sent', 'campaign-1')).toBeNull()
  })
})
