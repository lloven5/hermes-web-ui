import { describe, expect, it } from 'vitest'
import { getDataDir, getListenHost } from '../../packages/server/src/config'

describe('server config', () => {
  it('does not force an IPv4 bind host by default', () => {
    expect(getListenHost({})).toBeUndefined()
  })

  it('uses BIND_HOST when provided', () => {
    expect(getListenHost({ BIND_HOST: ' :: ' })).toBe('::')
  })

  it('ignores blank BIND_HOST values', () => {
    expect(getListenHost({ BIND_HOST: ' ' })).toBeUndefined()
  })

  it('resolves data dir under HERMES_DATA_DIR by default', () => {
    expect(getDataDir({ HERMES_DATA_DIR: '/opt/data' })).toBe('/opt/data/.hermes-web-ui/data')
  })

  it('uses DATA_DIR when set', () => {
    expect(getDataDir({ DATA_DIR: '/tmp/custom', HERMES_DATA_DIR: '/opt/data' })).toBe('/tmp/custom')
  })
})
