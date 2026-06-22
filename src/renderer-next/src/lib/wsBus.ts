// 协作 WebSocket 消息总线。
// 背景: 服务器对「每个用户只允许一条 WS 连接」(见 collab_server2 closeDuplicateConnections),
// 第二条同账号 WS 会把前一条踢下线并提示「账号在别处登录」。因此全应用只能有一条 WS ——
// 由协作聊天(useChat)持有; 其它功能(云同步 / 组队日历实时)不得自建连接, 改为订阅本总线。
type WsMessage = Record<string, unknown>
type Listener = (msg: WsMessage) => void

const listeners = new Set<Listener>()

export const wsBus = {
  // useChat 收到任意消息后调用, 广播给所有订阅者。
  publish(msg: WsMessage): void {
    for (const l of listeners) {
      try {
        l(msg)
      } catch {
        /* 单个订阅者出错不影响其它 */
      }
    }
  },
  // 订阅; 返回退订函数。
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}
