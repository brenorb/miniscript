import { describe, expect, it } from 'vitest'

describe('assistant module', () => {
  it('loads without signature validation errors', async () => {
    const module = await import('./assistant')

    expect(typeof module.loadAssistant).toBe('function')
    expect(module.optimizeDesignDemos).toBeTypeOf('function')
  })
})
