import { describe, it, expect } from 'vitest'
import { createWorkspaceConfig } from '../lib/workspaceConfig'

const user = { email: 'c@example.com', user_metadata: {} } as any

describe('createWorkspaceConfig — per-family default customTemplate (ADR-0005 slice 2)', () => {
  it('fresh user with no data gets the engineering default template', () => {
    const ws = createWorkspaceConfig({ user, templates: [], data: null })
    expect(ws.targetRole).toBe('engineering')
    expect(ws.customTemplate.body).toContain('{{feature_line}}')
    expect(ws.customTemplate.body).toContain('{{fit_angle}}')
    expect(ws.customTemplate.body).not.toContain('{{trigger_line}}')
    expect(ws.customTemplate.name).toBe('Founder intro')
  })

  it('saved targetRole=gtm with no saved customTemplate gets the GTM default template', () => {
    const ws = createWorkspaceConfig({
      user,
      templates: [],
      data: { targetRole: 'gtm' },
    })
    expect(ws.targetRole).toBe('gtm')
    expect(ws.customTemplate.body).toContain('{{trigger_line}}')
    expect(ws.customTemplate.body).toContain('{{proof_of_motion}}')
    expect(ws.customTemplate.body).not.toContain('{{feature_line}}')
    expect(ws.customTemplate.name).toBe('GTM intro')
  })

  it('product targetRole reads the engineering default (shared pipeline)', () => {
    const ws = createWorkspaceConfig({
      user,
      templates: [],
      data: { targetRole: 'product' },
    })
    expect(ws.targetRole).toBe('product')
    expect(ws.customTemplate.body).toContain('{{feature_line}}')
  })

  it('operations targetRole gets the ops default template (slice 3)', () => {
    const ws = createWorkspaceConfig({
      user,
      templates: [],
      data: { targetRole: 'operations' },
    })
    expect(ws.targetRole).toBe('operations')
    expect(ws.customTemplate.body).toContain('{{inflection_line}}')
    expect(ws.customTemplate.body).toContain('{{system_built}}')
    expect(ws.customTemplate.body).not.toContain('{{feature_line}}')
    expect(ws.customTemplate.body).not.toContain('{{trigger_line}}')
    expect(ws.customTemplate.name).toBe('Ops intro')
  })

  it('saved customTemplate is NOT clobbered by the per-family default when the user has one', () => {
    // ADR-0005: existing users with a saved customTemplate keep theirs.
    // The per-family default only kicks in when nothing's saved.
    const ws = createWorkspaceConfig({
      user,
      templates: [],
      data: {
        targetRole: 'gtm',
        customTemplate: {
          id: '',
          name: 'My custom',
          subject: 'Hello',
          body: 'Hi {{first_name}}, custom body.',
          attachmentIds: [],
          isShared: false,
        },
      },
    })
    expect(ws.targetRole).toBe('gtm')
    expect(ws.customTemplate.name).toBe('My custom')
    expect(ws.customTemplate.body).toBe('Hi {{first_name}}, custom body.')
    // GTM merge tags absent because the user's saved template took priority.
    expect(ws.customTemplate.body).not.toContain('{{trigger_line}}')
  })
})
