import type { AppInterface } from '@micro-app/types'

// jsdom does not implement Worker, mock it before importing micro-app modules
jest.mock('../../../proxies/worker', () => ({ __esModule: true, default: function Worker () {} }))

import { extractScriptElement, runScript } from '../../../source/scripts'
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

describe('runScript module script order', () => {
  const rawSetAttribute = globalEnv.rawSetAttribute

  beforeEach(() => {
    globalEnv.rawSetAttribute = Element.prototype.setAttribute
  })

  afterAll(() => {
    globalEnv.rawSetAttribute = rawSetAttribute
  })

  function createContainerApp (): AppInterface {
    const container = document.createElement('micro-app-body')
    return {
      name: 'test-app',
      url: APP_URL,
      source: {
        scripts: new Set<string>(),
      },
      querySelector: (selector: string) => (selector === 'micro-app-body' ? container : null),
    } as unknown as AppInterface
  }

  function createModuleScriptInfo (attrs: Record<string, string> = {}) {
    return {
      code: 'window.__vite_is_modern_browser = true',
      isExternal: false,
      appSpace: {
        'test-app': {
          module: true,
          inline: true,
          attrs: new Map(Object.entries(attrs)),
        },
      },
    } as unknown as Parameters<typeof runScript>[2]
  }

  function getInsertedScript (app: AppInterface): HTMLScriptElement {
    const container = app.querySelector('micro-app-body') as HTMLElement
    return container.querySelector('script') as HTMLScriptElement
  }

  // jsdom 16 does not implement HTMLScriptElement.async, install a spy accessor
  function spyAsyncSetter () {
    const calls: boolean[] = []
    const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'async')
    Object.defineProperty(HTMLScriptElement.prototype, 'async', {
      configurable: true,
      get () {
        return descriptor && descriptor.get ? descriptor.get.call(this) : undefined
      },
      set (value: boolean) {
        calls.push(value)
      },
    })
    return {
      calls,
      restore () {
        if (descriptor) {
          Object.defineProperty(HTMLScriptElement.prototype, 'async', descriptor)
        } else {
          Reflect.deleteProperty(HTMLScriptElement.prototype, 'async')
        }
      },
    }
  }

  test('static module script keeps document order', () => {
    const app = createContainerApp()
    const spy = spyAsyncSetter()
    try {
      runScript('inline-static', app, createModuleScriptInfo())

      expect(getInsertedScript(app).getAttribute('type')).toBe('module')
      expect(spy.calls).toEqual([false])
    } finally {
      spy.restore()
    }
  })

  test('keep async when the origin script declares async', () => {
    const app = createContainerApp()
    const spy = spyAsyncSetter()
    try {
      runScript('inline-async', app, createModuleScriptInfo({ async: '' }))

      expect(spy.calls).toEqual([])
    } finally {
      spy.restore()
    }
  })

  test('dynamic module script keeps async', () => {
    const app = createContainerApp()
    const replaceElement = document.createElement('script')
    const spy = spyAsyncSetter()
    try {
      runScript('inline-dynamic', app, createModuleScriptInfo(), void 0, replaceElement)

      expect(spy.calls).toEqual([])
    } finally {
      spy.restore()
    }
  })
})
