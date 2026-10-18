# OpenCode Monitor 1.3.0-rc.3

完整保留可获得的性能元数据，让人只看简洁前端，让 AI 读取详细历史。只读 OpenCode 数据库和日志；不调用模型，不保存提示词、回复正文、工具输入输出或鉴权头。

## 当前测速与历史详情

首页只显示本轮测速。首次安装或从 rc.1 升级到 rc.2 时创建独立测速起点；自动发现的 OpenCode 旧记录、导入的历史和 benchmark 均保留在数据库中，但不填入当前测速卡片。新调用开始后才出现当前模型和速度；模型按完整 provider/model 标识区分，不按显示名称合并。

A→B 会重新计算本轮均速、曲线、Token 用量和 1000 万 Token 区间；B→A 也从新一轮开始。B 缺少可靠计时时显示等待，不显示 A 的旧速度。“重新测速”重新设置起点，不删除任何历史；重启程序保留该起点。本轮异常值判断也独立计算，不沿用旧轮次的阈值。多来源并发时以最近实际调用的模型确定当前一轮，来源模型交错也会分轮；仅在 OpenCode 界面预选模型、尚未产生新调用时无法提前识别。

首页新增本轮最近 20 条记录；“显示详情”展开输入、耗时、TTFT 和来源。“历史详情”可按模型查看旧记录，不影响当前测速；完整 AI API/导出继续保留全部历史。GET /api/measurement 返回当前测速及历史模型列表；原 /api/dashboard 默认 all 的完整历史口径保持兼容。POST /api/measurement/reset 仅允许同源带 X-Monitor-Action: reset 的交互。

## 在线和本地更新

页面打开时自动检查此仓库的 GitHub Releases，也可点击“检查更新”；发现新版本后显示“一键更新”。用户点击后才下载和安装，不自动静默替换。更新源固定为 [icarus-3/opencode-monitor](https://github.com/icarus-3/opencode-monitor)，验证 GitHub 资产 SHA256 和包内每个文件的清单，拒绝路径穿越、重复 ZIP 项、符号链接、个人 config.json、数据库和 seed。正式版渠道不自动转入 RC，RC 渠道可以接收后续 RC 或正式版。

更新前一致性备份 SQLite 至 data/update-backups/，并备份被替换的程序文件。等待后台及托盘停止后替换程序，保留配置、全部历史、插件路径及 App 浏览器资料，随后后台重启。失败时尝试恢复程序文件；数据库备份保留供恢复，不自动倒退或覆盖采集数据。诊断在 data/update-status.json 和 data/update-helper.log。关闭页面不取消已启动的更新辅助程序。

rc.1 尚无应用内更新按钮，首次升级需使用本地更新包：解压 opencode-monitor-1.3.0-rc.3-update.zip 到安装目录外，在解压后的项目目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apply-update.ps1 -InstallDir D:\OpenCode\opencode-monitor-v1.3.0-rc.1
```

它会自动停止旧服务并更新原目录；目录名保留旧名称，实际版本以页面/health/package.json 为准。需要 Node 24 和 Windows 内置 PowerShell，无管理员要求。首次新安装仍使用 install.ps1。离线更新验证包内清单并拒绝降级；下载包可先与 SHA256SUMS-1.3.0-rc.3.txt 核对。

托盘单击或“打开监控界面（默认浏览器）”始终尊重 Windows 默认浏览器，包括 Chrome；不修改默认设置。“打开 App 窗口”为可选浏览器应用模式：默认浏览器是 Chrome/Edge 时使用对应引擎，否则尝试本机 Edge，再回退默认浏览器。它隐藏地址栏和标签栏，使用独立资料目录，关闭窗口仍保留后台。该模式不是额外捆绑 Electron 的原生 UI。

## Windows 11 安装

需要 Node.js 24+；托盘使用 Windows 11 自带的 .NET Framework 4.x，无 Electron、Python 或额外 npm 运行依赖。Python 仅用于远端 SSH 投影或开发测试。已在 Windows 11 x64 / Node 24.15.0 验证。

解压 Windows 包后运行（普通用户即可，不需要管理员权限）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

默认安装到 `%LOCALAPPDATA%\OpenCodeMonitor`。本次命令的 ExecutionPolicy 仅作用于该进程，不修改系统策略。安装完成即后台运行，不打开浏览器。随后直接启动 OpenCode CLI 或桌面应用时，由全局插件加载 Monitor，不依赖 start.cmd 包装 OpenCode，不设置开机启动、计划任务或进程轮询。

导入旧监控历史，或使用自定义 OpenCode XDG 配置目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -InstallDir D:\OpenCode\Monitor -LegacyRoot D:\OpenCode\opencode-monitor -PluginDirectories D:\OpenCodeData\config\opencode\plugins
```

插件安装到 `~/.config/opencode/plugins/opencode-monitor.js`、当前 `XDG_CONFIG_HOME/opencode/plugins`（若设置）及显式提供的目录。安装器备份同名插件，保留现有 config，改默认模型为 all，并合并 auto 来源发现。其他自定义配置目录需要显式传入；`--pure` 会禁用外部插件。`data/installed-plugins.json` 记录实际安装位置。

托盘位于 Windows 通知区域，也可能收在 `^` 隐藏图标中；图标是否固定显示由 Windows 设置决定。单击打开 `http://127.0.0.1:8765`，右键有“打开监控界面 / 状态 / 退出监控器”。关闭浏览器不停止后台；退出菜单停止 Monitor 和托盘，不停止 OpenCode。重复启动复用同一端口实例。端口被其他程序占用、Node 不可用或启动失败会弹出诊断，日志位于 data/tray.log。

手动运行 `MonitorTray.exe`、start.cmd 或 start.ps1 均保持后台运行；双击 start.vbs 不出现终端窗口。`stop.cmd`/stop.ps1 使用本地控制令牌停止后台，托盘随即退出。`node server.mjs` 仍可用于前台调试，Ctrl+C 停止。安装目录需当前用户可写，Node 需在 PATH 中，也可自行放入 runtime/node.exe。

移除自动启动入口可执行 `uninstall-hooks.ps1`；历史和备份不删除。安装器不会修改 OpenCode 的可执行文件、启动脚本、凭据或安全软件。更新正在运行的安装前先 stop.cmd；不要直接覆盖使用中的托盘 EXE。

## 桌面重新启动修复（rc.3）

桌面托盘退出后，OpenCode 的后台服务可能继续运行。原插件只在 setup/server 执行时拉起 Monitor，重新打开桌面并不保证再次执行钩子。rc.3 增加 OpenCodeWindowHook.exe，由插件启动，通过 Windows SetWinEventHook 接收顶层窗口显示事件，仅匹配允许路径中的 OpenCode.exe，并按进程启动身份去重。没有进程扫描、开机启动或计划任务，不修改 OpenCode 程序。

默认识别 `%LOCALAPPDATA%/Programs/@opencodedesktop/OpenCode.exe`；非默认安装可在 config.json 添加 `"desktopExecutables": ["D:/Apps/OpenCode/OpenCode.exe"]`，重新加载插件后生效。新桌面进程出现时再次启动 Monitor，托盘互斥锁保证单实例。同一进程窗口显示或切换焦点不会撤销用户主动退出 Monitor 的操作；隐藏并恢复同一进程不算重新启动。

退出 Monitor 停止托盘和采集进程。小型事件桥归 OpenCode 插件宿主所有，保留到宿主退出，以便下一次桌面启动恢复 Monitor；不采集会话内容。诊断见 data/desktop-startup.log、data/window-hook.pid。uninstall-hooks.ps1 同时停止桥，不删除历史。桥从 data/window-hook/ 的内容哈希副本运行，不锁住待更新程序。

更新器备份并刷新 data/installed-plugins.json 中属于本安装的全局插件，失败时一并回滚；其他安装的插件保持原样。已经加载的旧插件不被强制重载，避免打断任务；服务自然重启或位置重新加载后才加载新插件。当前机器可确认宿主 PID 后单独启用桥，无需关闭服务。

机制依据：[OpenCode 插件生命周期](https://opencode.ai/v2/docs/build/plugins/#lifecycle)、[Windows SetWinEventHook](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook)。

## OpenCode 支持范围

| 入口 | 已验证情况 | 条件/边界 |
|---|---|---|
| V1 CLI 1.18.29 | 真实 debug wait 加载插件并拉起托盘；无需包装脚本 | server() 生命周期；禁用插件时不自动启动 |
| V2 2.0.32（桌面内置 CLI） | 隔离服务中插件 active，自动拉起 Monitor | setup() 生命周期；加载项目/位置时执行 |
| 本机 Electron 桌面 OpenCode 2.0.32 | 插件冷启动及 Windows 窗口事件补足桌面进程重启 | 同一 Windows 用户会话；默认安装路径或 desktopExecutables 指定路径；复用旧后台服务不再依赖 setup 重跑 |
| 其他 V1/V2、ARM64、WSL、远端桌面 | 未认证 | Windows 托盘插件只在 win32 上启动；WSL 不是 Windows 本机 CLI |

双入口形状依据 [官方插件兼容说明](https://opencode.ai/v2/docs/build/plugins/#support-v1)；V1 1.18.29 之前不承诺兼容。托盘跨 OpenCode 退出独立驻留。安装后已经运行的 OpenCode 应重新打开项目或重载插件，以加载新入口。没有使用不可靠的定时启动来掩盖这些生命周期边界。

## 数据与无损升级

`data/monitor.sqlite` 使用 WAL，无历史 TTL。升级旧 schema 前用 SQLite VACUUM INTO 生成 `backup-before-v2-*.sqlite`，覆盖 WAL 中已提交数据；失败时中止升级。显式导入旧库前，对源库和目标库分别生成一致性备份。原始安装目录不会被迁移工具删除或改写。旧库中存在但源 OpenCode 已删除的记录仍会保留。

```powershell
node migrate.mjs --history old-monitor/data/monitor.sqlite
node migrate.mjs --seed old-monitor/seed
```

也兼容安装目录已有 seed/ 的自动导入。发布包不含任何人的 seed、数据库或配置。导入恢复 measurements/identities 的 20 条旧样本和对应冻结基准（若输入包含这些样本），并保留 benchmark 的 process_duration 等专属字段。所有数值/布尔原始测量及必要身份字段进入遥测表；provenance 文件保留 SHA-256 来源指纹。相同 ID 的普通采集不覆盖冻结 seed；历史碰撞的两个版本归档保存。源库和目标当前值冲突时目标优先，seed 优先保留冻结指标。

| 数据表 | 用途 |
|---|---|
| records | 当前派生指标；兼容原 API |
| telemetry_v1 | 追加、按内容去重的性能元数据；包含 source、observed_at、extractor、confidence |
| record_versions_v1 | 每个 record 的不同派生版本；保留旧字段和重算前结果 |
| events / streams / live_parts / baselines | 原错误/压缩、stream 起点、分段计时、冻结基准 |

schema 版本为 2，提取器版本为 5。升级前的指标标为 legacy_derived / original_inputs_unavailable，不能将它们伪称为已经恢复的原始输入。新采集保留 token 分类、cost、模型、完成状态、错误状态码/类型、step/tool/compaction 类型和性能时间；排除消息正文和工具载荷。完整 HTTP 成功状态码、网络包和服务端计时不可从这些来源推断。

有部分分段计时时，速度仍可作为带 quality 标记的估值，不是完整计时的等精度测量。异常高 TPS 只从显示/均值排除，原始指标、token 和调用记录不删除。缺基准/样本不足时返回 Insufficient evidence。统计单位是 assistant 消息，不等于物理 HTTP 请求或重试次数。

## AI API 和导出

全部 HTTP 接口只监听 127.0.0.1，默认 8765，无跨域许可。不要把端口转发到公网。它们包含本机路径、会话标识和用量，适合本机 AI 使用。

- `/api/dashboard?model=all&from=2026-10-17T00:00:00Z&to=2026-10-19T00:00:00Z`：兼容完整派生指标、基准、事件、诊断和简洁前端。
- `/api/history?limit=1000&after=0`：原始当前指标 JSON，不受曲线 120 条限制。
- `/api/telemetry?limit=1000&after=0`：可离线重算的白名单性能输入与来源。
- `/api/versions?limit=1000&after=0`：历史派生版本。
- `/api/diagnostics`：完整性、覆盖边界、来源状态、计数及诊断；不新增诊断网页。
- `/api/health`：应用身份、版本、PID 和扫描状态，供托盘诊断。

分页响应含 schema_version / extractor_version / snapshot / next / done / items。后续页带上同一 snapshot 和 after=next；limit 为 1–10000。遥测与版本表只追加；history 是查询时当前值，跨页期间可能更新。需要严格一致快照时使用以下 JSONL 导出（只读 SQLite 事务，目标文件必须不存在）：

```powershell
node export.mjs history history.jsonl
node export.mjs telemetry telemetry.jsonl
node export.mjs versions versions.jsonl
node export.mjs events events.jsonl
node export.mjs baselines baselines.jsonl
```

本地控制 POST 接口用 data/control.token 鉴权，令牌不通过 GET API 返回。插件只转发四种 text/reasoning started/ended 计时事件，且传输前再次白名单投影。默认不为监听事件而启动 OpenCode 服务。不要在 AI 分析或发布文件中携带 control.token。

## 配置与 SSH

参考 config.example.json。auto 同时寻找 XDG、用户标准数据目录和原 D 盘数据目录。SSH 的单个来源可配置如下（远端不需要安装 Monitor）：

```json
{"id":"server1","host":"your-ssh-alias","path":"~/.local/share/opencode/opencode.db","logDirectories":["~/.local/share/opencode/log"],"timeoutMs":18000}
```

放入 config.json 的 sshDatabases 数组。需用户已配置好的 OpenSSH 密钥/代理与 known_hosts、远端 Python3 + SQLite。使用 BatchMode，不保存密码；不会修改安全策略或静默接受未知主机密钥。远端先投影再传输，不带回正文、工具载荷、响应体或凭据；本地 data/remote-sources 只保留该投影，供迟到事件补算。变化签名为投影内容 SHA-256，旧行回写即使不改变水位也会触发全量重提取。

SSH 当前仅支持 session_message V2 schema；不承诺远端旧 message/part。远端日志必须显式配置，才能补上 stream 起点、临时错误和 compaction；日志失败会报告但不阻断数据库采集。该日志投影读取所配置现存日志，32 MiB 返回上限和超时会报错，不把部分读取冒充完整。实时 SSH 计时仍依赖 Linux /proc 中运行的 OpenCode 和可用 api 命令；非 Linux、只在 WSL 内运行、未运行服务或断线期间无法保证实时覆盖。没有可用 stream 起点时 TTFT/E2E 为 null，绝不伪造。

已删除的日志、停机期间只在事件流存在的数据、源未记录的重试、未知 schema 和服务端内部等待不可事后恢复。本地增量扫描依赖源 time_updated；不更新时间的任意本地手工回写需清除 db/dbv2 水位后重扫。保留的元数据支持复算已观测指标，不等于完整会话或网络录制。

## 构建与测试

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File build.ps1
npm test
```

托盘由系统 C# 编译器构建为 winexe。完整开发测试设置 TEST_PYTHON（Python 路径）、TEST_V1（V1 CLI 路径）、TEST_V2（桌面 CLI 路径）；未设置时相应平台测试会明确 skip。端到端测试使用临时库、独立配置目录及 18765/18766 端口，不发模型请求。不要与其他同端口测试同时运行。检查 skip 数，不能把未运行的测试算作通过。真实 SSH 网络/密钥和 Windows ARM64 尚未现场验证。

## 发布

当前为 1.3.0-rc.3。Windows 安装包与本地更新包使用相同程序和逐文件清单，含托盘 EXE、源码、安装器、测试、说明；不捆绑 Node，不含个人数据。开发者可先运行 build.ps1，再用 node build-release.mjs OUTPUT_DIRECTORY 生成两种包和 SHA256SUMS。保持 rc，直到已声明的支持边界获得更多现场验证。
