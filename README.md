# dsh-plugin-sudo

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的 `sudo_run` 工具插件。

Agent 需要 root 权限时，**在 DSH 的提问面板里**向你要 sudo 密码——掩码输入，密码直接从面板进 `sudo` 的 stdin。它不会出现在工具参数、工具结果、会话记录或模型上下文里。

```
提问面板（掩码输入） ──▶ 插件进程内存 ──▶ sudo 的 stdin ──▶ child stdin
```

模型只能看到 `command` 和返回的 stdout / stderr。

## 安装

插件只依赖 `node:child_process`，没有任何 npm 依赖，也不需要构建。

### 方式一：克隆到 profile 的插件目录（最简单）

```bash
git clone https://github.com/lovesion/dsh-plugin-sudo.git \
  "${DSH_HOME:-$HOME/.dsh}/profiles/dsh-tui/plugins/dsh-plugin-sudo"
```

然后在 profile 的 `cordis.patch.yml` 末尾加一条：

```yaml
- insert:
    - id: tool-sudo
      name: "./plugins/dsh-plugin-sudo/index.mjs"
```

重启 DSH（或等 Cordis 热重载）后，`sudo_run` 就出现在工具列表里。

### 方式二：作为 npm bundle 安装

如果这个包发布到了 npm：

```bash
dsh plugin --profile dsh-tui add dsh-plugin-sudo
```

包内的 `cordis.patch.yml`（`dsh.bundle.patch` 指向它）会负责把插件插进 profile。这个包目前**没有发布到 npm**，所以这条路径暂时不可用。

### 兼容性

在 DSH 0.19.0 / Node.js 26 / Arch Linux 上测试通过。插件只用到宿主提供的 `tools` 和 `userQuestions` 两个服务。

## 用法

工具名 `sudo_run`：

| 参数 | 必填 | 说明 |
|---|---|---|
| `description` | 是 | 命令的主动语态短描述，显示在密码提示里 |
| `command` | 是 | 用 `bash -lc` 执行的命令 |
| `timeoutMs` | 否 | 超时毫秒，默认 `120000`，上限 `600000` |

返回 `{ exitCode, stdout, stderr }`。非零退出码是正常结果，由 agent 自行判断；超时返回 `124`，取消返回 `130`。stdout / stderr 各自只保留末尾 32 KB。

## 工作流程

1. 先跑 `sudo -n true`。sudo 时间戳还有效时直接用缓存凭据，不打扰你。
2. 否则通过 `userQuestions` 提一个 `secret: true` 的问题，头部是「sudo 密码」。
3. 密码写进 `sudo -S -p ''` 的 stdin（不经过 argv，`ps` 看不到），随后用 `Buffer.fill(0)` 清零。
4. 没有输入或取消时明确返回 `130`，不会静默失败。

## 安全边界

- 密码放在 JSON-RPC 应答里，从提问面板直达插件内存，**不经过聊天消息**。
- 插件不记录、不落盘密码；密码字符串是 JS 的不可变字符串，无法原地擦除——这是语言层限制，Buffer 部分已经清零。
- 插件不缓存密码，复用 sudo 自己的时间戳。
- 提权能力本身有意义：**装之前请确认你信任这个插件**。它的全部行为都在 `index.mjs` 的 177 行里，可以直接读完。

## 已知限制

- 如果 sudo 配置了 `requiretty`，stdin 管道会失败。
- **不要直接传 `yay` / `paru`**：它们内部会再调 sudo，拿不到 stdin，会报「读取密码需要一个终端」。用等效的 `pacman` 命令，或先在终端 `sudo -v`。
- 如果提问面板没有显示成掩码（`•`），说明当前宿主的 UI 忽略了 `secret` 字段；密码仍然不进模型上下文，只是输入时可见。
- Windows 原生环境不可用（依赖 Unix 的 `sudo`）。

## License

MIT
