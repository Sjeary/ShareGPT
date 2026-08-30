import assert from 'node:assert/strict'
import test from 'node:test'
import { useAiStore } from './useAiStore.ts'

test('Principal invalidation clears all AI tab and feedback runtime state', () => {
  const store = useAiStore.getState()
  store.setTabs(
    'gpt',
    [
      {
        id: 'alice-gpt',
        title: 'Alice GPT',
        url: 'https://chatgpt.com/c/alice',
        allowExternalBrowsing: false,
        webviewInitialized: true,
        webviewLoading: false,
        canGoBack: false,
        canGoForward: false,
      },
    ],
    'alice-gpt',
  )
  store.setFeedback('claude', 'Alice page failed', 'error')

  useAiStore.getState().resetRuntime()

  const cleared = useAiStore.getState()
  assert.deepEqual(cleared.tabsByKind, { gpt: [], gemini: [], claude: [] })
  assert.deepEqual(cleared.activeTabIdByKind, { gpt: '', gemini: '', claude: '' })
  assert.deepEqual(cleared.feedbackByKind, {
    gpt: { text: '', tone: '' },
    gemini: { text: '', tone: '' },
    claude: { text: '', tone: '' },
  })
})
