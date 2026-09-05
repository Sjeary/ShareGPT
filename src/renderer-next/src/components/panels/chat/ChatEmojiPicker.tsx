import { lazy, Suspense, type CSSProperties } from 'react'
import { Categories, EmojiStyle, Theme, type EmojiClickData } from 'emoji-picker-react'
import { useAppStore } from '@/store/useAppStore'

const EmojiPicker = lazy(() => import('emoji-picker-react'))

export function ChatEmojiPicker({
  onEmojiClick,
}: {
  onEmojiClick: (data: EmojiClickData) => void
}) {
  const dark = useAppStore((state) => state.dark)
  return (
    <div className="h-[min(380px,calc(var(--radix-popover-content-available-height)-2px))] w-[min(300px,calc(var(--radix-popover-content-available-width)-2px))] overflow-hidden">
      <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">加载表情…</div>}>
        <EmojiPicker
          onEmojiClick={onEmojiClick}
          theme={dark ? Theme.DARK : Theme.LIGHT}
          emojiStyle={EmojiStyle.NATIVE}
          lazyLoadEmojis
          autoFocusSearch={false}
          searchPlaceholder="搜索表情"
          previewConfig={{ showPreview: false }}
          categories={[
            { category: Categories.SUGGESTED, name: '常用' },
            { category: Categories.SMILEYS_PEOPLE, name: '表情与人物' },
            { category: Categories.ANIMALS_NATURE, name: '动物与自然' },
            { category: Categories.FOOD_DRINK, name: '食物与饮品' },
            { category: Categories.TRAVEL_PLACES, name: '旅行与地点' },
            { category: Categories.ACTIVITIES, name: '活动' },
            { category: Categories.OBJECTS, name: '物品' },
            { category: Categories.SYMBOLS, name: '符号' },
            { category: Categories.FLAGS, name: '旗帜' },
          ]}
          width="100%"
          height="100%"
          style={
            {
              '--epr-header-padding': '8px',
              '--epr-search-input-height': '32px',
              '--epr-category-navigation-button-size': '24px',
              '--epr-category-label-height': '24px',
            } as CSSProperties
          }
        />
      </Suspense>
    </div>
  )
}
