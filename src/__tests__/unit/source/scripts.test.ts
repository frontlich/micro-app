import type { AppInterface } from '@micro-app/types'

// jsdom does not implement Worker, mock it before importing micro-app modules
jest.mock('../../../proxies/worker', () => ({ __esModule: true, default: function Worker () {} }))

import { extractScriptElement } from '../../../source/scripts'
import globalEnv from '../../../libs/global_env'

const APP_URL = 'http://child.com/sub/index.html'

function createApp (): AppInterface {
  return {
    name: 'test-app',
    url: APP_URL,
    source: {
      scripts: new Set<string>(),
    },
  } as unknown as AppInterface
}

function createScript (attrs: Record<string, string>): HTMLScriptElement {
  const script = document.createElement('script')
  Object.keys(attrs).forEach((key) => script.setAttribute(key, attrs[key]))
  return script
}

describe('extractScriptElement nomodule', () => {
  const rawSupportModuleScript = globalEnv.supportModuleScript
  const rawSetAttribute = globalEnv.rawSetAttribute

  beforeEach(() => {
    globalEnv.supportModuleScript = true
    globalEnv.rawSetAttribute = Element.prototype.setAttribute
  })

  afterAll(() => {
    globalEnv.supportModuleScript = rawSupportModuleScript
    globalEnv.rawSetAttribute = rawSetAttribute
  })

  test('keep static nomodule script as an inert node', () => {
    const app = createApp()
    const parent = document.createElement('div')
    const script = createScript({
      nomodule: '',
      id: 'vite-legacy-polyfill',
      src: './assets/polyfills-legacy.js',
    })
    Object.defineProperty(script, 'noModule', { value: true, configurable: true })
    parent.appendChild(script)

    const result = extractScriptElement(script, parent, app)

    expect(result).toBe(script)
    expect(parent.contains(script)).toBe(true)
    expect(script.getAttribute('id')).toBe('vite-legacy-polyfill')
    expect(script.hasAttribute('nomodule')).toBe(true)
    expect(script.getAttribute('src')).toBe('http://child.com/sub/assets/polyfills-legacy.js')
    expect(app.source.scripts.size).toBe(0)
  })

  test('keep nomodule entry script id and data-src for legacy fallback', () => {
    const app = createApp()
    const parent = document.createElement('div')
    const script = createScript({
      nomodule: '',
      id: 'vite-legacy-entry',
      'data-src': '/assets/index-legacy.js',
    })
    script.textContent = "System.import(document.getElementById('vite-legacy-entry').getAttribute('data-src'))"
    Object.defineProperty(script, 'noModule', { value: true, configurable: true })
    parent.appendChild(script)

    const result = extractScriptElement(script, parent, app)

    expect(result).toBe(script)
    expect(script.getAttribute('id')).toBe('vite-legacy-entry')
    expect(script.getAttribute('data-src')).toBe('http://child.com/assets/index-legacy.js')
    expect(script.textContent).toContain('System.import')
    expect(app.source.scripts.size).toBe(0)
  })

  test('complete relative data-src of nomodule script', () => {
    const app = createApp()
    const parent = document.createElement('div')
    const script = createScript({
      nomodule: '',
      id: 'vite-legacy-entry',
      'data-src': './assets/index-legacy.js',
    })
    Object.defineProperty(script, 'noModule', { value: true, configurable: true })
    parent.appendChild(script)

    extractScriptElement(script, parent, app)

    expect(script.getAttribute('data-src')).toBe('http://child.com/sub/assets/index-legacy.js')
  })

  test('keep dynamic nomodule script as an inert node', () => {
    const app = createApp()
    const script = createScript({
      nomodule: '',
      src: './assets/polyfills-legacy.js',
    })
    Object.defineProperty(script, 'noModule', { value: true, configurable: true })

    const result = extractScriptElement(script, null, app, true)

    expect(result).toEqual({ replaceComment: null })
    expect(app.source.scripts.size).toBe(0)
  })

  test('drop module script when module is not supported', () => {
    globalEnv.supportModuleScript = false
    const app = createApp()
    const parent = document.createElement('div')
    const script = createScript({
      type: 'module',
      src: './assets/index.js',
    })
    parent.appendChild(script)

    extractScriptElement(script, parent, app)

    expect(parent.querySelector('script')).toBeNull()
    expect(app.source.scripts.size).toBe(0)
  })

  test('execute nomodule script when module is not supported', () => {
    globalEnv.supportModuleScript = false
    const app = createApp()
    const parent = document.createElement('div')
    const script = createScript({
      nomodule: '',
      src: './assets/polyfills-legacy.js',
    })
    Object.defineProperty(script, 'noModule', { value: true, configurable: true })
    parent.appendChild(script)

    extractScriptElement(script, parent, app)

    expect(parent.querySelector('script')).toBeNull()
    expect(app.source.scripts.size).toBe(1)
  })
})
