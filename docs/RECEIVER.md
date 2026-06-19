# 自建「集中代理出口」部署指南

> 面向**管理员 / 自建者**。普通用户只需装客户端、登录即用，与本文无关。
> 本文只讲 **Linux / Ubuntu CLI** 形式。文中所有 IP、端口、令牌、UUID、订阅均为**占位符**，请换成你自己的，且**切勿公开**。
> （对应代码里的 `receiver` 模式 / `buildReceiverFiles`。）

## 这是什么

「集中代理出口」是团队**共用的统一出口**：所有客户端的 AI 流量都从这里出网，成员无需各自配梯子。它由三块拼起来：

1. **本地梯子**（出口机上）：一个能真正上外网的本地代理（如 clash / [mihomo](https://github.com/MetaCubeX/mihomo)），监听本机某端口（记作 `<CLASH_PORT>`，常见 `7890`）。这是真正的"出口"。
2. **sing-box（vmess 中继）**：在出口机开一个 vmess 入站，收到连接后**转发给上面的本地梯子**。
3. **frp 内网穿透**：出口机通常在内网 / 家宽、没有公网 IP。用 frp 把 sing-box 的 vmess 端口**穿透**到一台有公网 IP 的小服务器上，客户端连那台公网服务器即可。

### 链路

```
客户端(App)
  └─ vmess/ws ─> 公网服务器:<REMOTE_PORT>   (frps 监听并暴露)
                   └─ frp 隧道 ─> 出口机: frpc ─> 出口机: sing-box (vmess 入站)
                                                    └─ socks ─> 本地梯子 (clash/mihomo)
                                                                   └─> 外网
```

| 机器                                         | 跑什么                                     | 公网 IP     |
| -------------------------------------------- | ------------------------------------------ | ----------- |
| **公网服务器**                               | `frps`（frp 服务端）                       | ✅ 需要     |
| **出口机**（Ubuntu / 树莓派 / ARM 小机均可） | `clash/mihomo` + `sing-box`(中继) + `frpc` | ❌ 内网即可 |

## 一、本地梯子（出口机）

装一个 clash 内核（推荐 mihomo），导入你自己的机场订阅，确认本机能上外网，记下它的代理监听端口 `<CLASH_PORT>`（clash 常见 `7890`；mihomo 的 `mixed-port`）。

```bash
mihomo -d /etc/mihomo          # 示例：mihomo 以配置目录方式运行
# 验证经它能出网：
curl -x socks5h://127.0.0.1:<CLASH_PORT> -I https://www.google.com
```

> 订阅 / 节点是你的私密信息，别写进任何会公开的文件。

## 二、sing-box（vmess 中继）

在出口机写一份 `singbox_server.json`：**vmess(ws) 入站 → socks 出站转给本地梯子**。

```json
{
  "log": { "level": "info", "timestamp": true },
  "inbounds": [
    {
      "type": "vmess",
      "tag": "vmess_in",
      "listen": "::",
      "listen_port": "<VMESS_PORT>",
      "users": [{ "uuid": "<你生成的UUID>" }],
      "transport": {
        "type": "ws",
        "path": "",
        "max_early_data": 2048,
        "early_data_header_name": "Sec-WebSocket-Protocol"
      }
    }
  ],
  "outbounds": [
    { "type": "socks", "tag": "forward", "server": "127.0.0.1", "server_port": "<CLASH_PORT>" }
  ],
  "route": { "final": "forward", "auto_detect_interface": true }
}
```

字段说明：

- `inbounds[0]`：vmess + WebSocket 入站，监听 `<VMESS_PORT>`（只在本机监听，对外靠下面的 frp 穿透）。`uuid` 用 `sing-box generate uuid` 生成，**客户端必须填同一个**。
- `outbounds[0]`：socks 出站指向第一步的本地梯子 `127.0.0.1:<CLASH_PORT>`。
- `route.final = "forward"`：进来的流量全部丢给本地梯子出网。

```bash
sing-box check -c singbox_server.json     # 启动前自检
sing-box run   -c singbox_server.json
```

## 三、内网穿透（frp）

出口机没有公网 IP，用 frp 把 `<VMESS_PORT>` 暴露到公网服务器的 `<REMOTE_PORT>`。

**公网服务器：frps（服务端）** —— `frps.toml`：

```toml
bindPort = 7000
auth.method = "token"
auth.token  = "<你的FRP令牌>"
```

```bash
frps -c frps.toml      # 建议做成 systemd 常驻
```

> 防火墙 / 安全组放行 `7000`（frp 控制端口）与 `<REMOTE_PORT>`（对外 vmess 端口）。

**出口机：frpc（客户端）** —— `frpc.ini`（老版 ini；新版 toml 字段同理）：

```ini
[common]
server_addr = <你的公网服务器IP或域名>
server_port = 7000
token       = <你的FRP令牌>
tls_enable  = true

[vmess-ws]
type        = tcp
local_ip    = 127.0.0.1
local_port  = <VMESS_PORT>     ; = sing-box 入站端口
remote_port = <REMOTE_PORT>    ; 公网服务器对外暴露的端口
use_encryption  = true
use_compression = true
```

```bash
frpc -c frpc.ini
```

至此：**客户端连 `公网服务器:<REMOTE_PORT>` → frp 透传到出口机 sing-box → 转给本地梯子出网。**

## 四、开机自启（systemd）

出口机上为 sing-box 与 frpc 各建一个 service（路径按需改），都设 `Restart=always`：

```ini
# /etc/systemd/system/relay-singbox.service
[Unit]
Description=sing-box vmess relay
After=network-online.target
[Service]
WorkingDirectory=/opt/relay
ExecStart=/opt/relay/sing-box run -c /opt/relay/singbox_server.json
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/relay-frpc.service
[Unit]
Description=frpc tunnel
After=network-online.target
[Service]
WorkingDirectory=/opt/relay
ExecStart=/opt/relay/frpc -c /opt/relay/frpc.ini
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now relay-singbox relay-frpc
# 本地梯子(clash/mihomo)同理做成 service
```

## 五、客户端怎么对接

客户端的网络 / 代理配置里，填的就是这套出口的"对外参数"：

| 客户端字段 | 填什么                               |
| ---------- | ------------------------------------ |
| 代理服务器 | `<你的公网服务器IP或域名>`           |
| 端口       | `<REMOTE_PORT>`                      |
| UUID       | sing-box 里那个 `<UUID>`（必须一致） |

客户端本机也会起一个 sing-box，把 AI 站点流量经 vmess 发到这套出口，统一从你的本地梯子出网。

## 排错

- frpc 报鉴权失败 → 两端 `token` 不一致，或 `server_addr/port` 写错。
- 客户端连不上 → 公网服务器防火墙没放行 `<REMOTE_PORT>`，或 frps 没起。
- 能连但不通外网 → 出口机 `sing-box check` 不过，或本地梯子 `<CLASH_PORT>` 不对 / 本身没出网（先用 `curl -x socks5h://127.0.0.1:<CLASH_PORT>` 验证）。
- 看 sing-box / frpc 日志定位是哪一段断的。
