export const LANGUAGES = [
  ['auto', '自动检测'],
  ['zh', '中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['ru', 'Русский'],
] as const

export const TARGET_LABELS = Object.fromEntries(LANGUAGES) as Record<string, string>
