# Pace your thought with agents · 技术章程

首版交付一个 VS Code 侧栏扩展，接入编辑器终端里的 Codex CLI。浏览器提供现场全屏回放。采集、整理和展示围绕同一份本地项目记忆工作。

| 环节 | 首版选择 | 用途 |
| --- | --- | --- |
| 对话接入 | Codex 项目级 hooks | 记录用户发言、受支持的工具执行结果和轮末可见回复。按项目启用一次，之后照常对话。[Codex hooks](https://developers.openai.com/codex/hooks) |
| 记忆与整理 | 外部 Node.js 24、内置 SQLite、Codex CLI 结构化输出 | Node 负责落库；每轮结束后用已有的 Codex 登录异步提炼想法和关系，保留原始依据。 |
| 画布 | TypeScript、React、React Flow、Vite | 同一个画布组件负责卡片、带文字的关系线、来源详情和历史展开。依赖随包提供。 |
| 两个入口 | VS Code Webview View、本机浏览器 | 侧栏跟随当前项目，全屏回放按原顺序推进同一批记录。浏览器通过本机回环地址加载演示包。[VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview) |
| 开发与分发 | npm、Node 自带测试工具、VSIX | 以 Windows 上的 VS Code 1.97.2、Codex CLI 0.154.0 和 Node 24 为首轮验证环境。扩展以可本地安装的 `.vsix` 分发，源码归入[项目仓库](https://github.com/southever/11.18-Hackthon/)。[VSIX 打包说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) |

## 一次对话如何成为记忆

1. 用户在工作区启用记录后，hook 将 `UserPromptSubmit`、`PostToolUse` 和 `Stop` 提供的可见事实写入本地数据库。项目用工作区根目录标识，会话与轮次保留各自的 ID。同一工作区换会话仍可接续。数据库由外部 Node 进程读写，不依赖编辑器内置的 Node 版本。
2. 采集先落库，整理在后台进行。整理器读取本轮记录与项目已有想法，输出新增或更新的节点、关系及来源 ID。有原话支持的选择才能进入“已决定”；只有工具结果支持的动作才标为“已执行”。待整理的轮次保留原文，可重试，重复处理同一记录不会新增一套节点。整理器在独立工作目录运行，排除自身调用，避免将整理过程录回项目。
3. 侧栏显示最新状态。浏览器读取从同一项目导出的回放包，按轮次重建当时的画布和 spec，避免在前几步提前揭示后续决定。Markdown 导出使用当前生效的节点，保留重要取舍及其依据。

日常项目记录保存在本机用户数据目录。路演包只收录专门录制的演示项目，预览、字体和画布资源随包提供。已有记录的播放和导出可离线完成，新增轮次的语义整理使用 Codex。
