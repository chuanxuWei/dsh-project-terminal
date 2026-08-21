import { describe, expect, it } from 'vitest'
import { resolveOptions } from '../src/service.js'

describe('Project Terminal options', () => {
  it('accepts bounded deployment settings and rejects checkout path escape', () => {
    expect(resolveOptions({ setupStatePath: '/tmp/state.json' })).toMatchObject({
      environmentFile: '.dsh/environment.json',
      maxTerminals: 8,
      agentReadMaxLines: 120,
    })
    expect(() => resolveOptions({ setupStatePath: '/tmp/state.json', environmentFile: '../outside.json' }))
      .toThrow('must stay inside the checkout')
    expect(() => resolveOptions({ setupStatePath: 'relative.json' })).toThrow('must be absolute')
  })
})
