# OpenCode Monitor

**Local, offline performance monitoring for OpenCode.** Read your existing session database and logs; view decode token/s, TTFT, tokens, errors and conservative performance-degradation diagnostics. No model calls, API keys, CDN or npm dependencies.

**Windows:** [Download the portable app](https://github.com/icarus-3/opencode-monitor/releases/latest/download/opencode-monitor-windows-x64.zip), extract the ZIP, then double-click **`start.cmd`**. Node.js is included. Open **http://127.0.0.1:8765**. Double-click **`stop.cmd`** to stop. The app runs on your computer, not on GitHub Pages.

## 下载即用

1. 从 [Releases](https://github.com/icarus-3/opencode-monitor/releases/latest) 下载 `opencode-monitor-windows-x64.zip`。
2. **完整解压**到有写入权限的目录，不要在 ZIP 内直接运行。
3. 双击 `start.cmd`，浏览器会打开本地 Dashboard。无需安装 Node.js、Python 或 npm 包。
4. 双击 `stop.cmd` 停止。关闭网页不会停止后台采集；重启电脑后需重新启动。

程序自动寻找 OpenCode 数据源。如果页面提示未发现数据库，编辑 `config.json` 后重启，例如：

```json
{
  "port": 8765,
  "pollSeconds": 8,
  "defaultModel": "opencode/deepseek-v4.1-flash-free",
  "databases": ["C:/your/opencode/data/opencode.db"],
  "logDirectories": ["C:/your/opencode/data/log"],
  "includeExampleRecords": false,
  "rollingWindow": 5
}
```

路径可使用 `/`。默认 `"auto"` 检查 `$XDG_DATA_HOME/opencode`、用户目录 `.local/share/opencode`、Windows Local/Roaming AppData 下 `opencode`，以及常见自定义目录 `D:/OpenCodeData/data/opencode`。其他自定义目录可能需要手动填写。

## 从源码运行 / Run from source

安装 Node.js **24 或更新版本**后：

```sh
git clone https://github.com/icarus-3/opencode-monitor.git
cd opencode-monitor
node --test test.mjs
node server.mjs
```

打开 http://127.0.0.1:8765 ，按 Ctrl+C 停止。macOS/Linux 可从源码运行，Windows 启停脚本不适用。无需 `npm install`。

## 功能

- 最近 decode TPS、最近 20 条 median、参考 baseline 和 normalized TPS。
- TTFT、input/cache/output/reasoning tokens、客户端报告 cost。
- decode 随时间、normalized TPS 随累计 tokens、TTFT、429/错误/compaction 四种图表。
- 模型及 UTC+8 时间筛选，每 8 秒刷新或手动刷新。
- SQLite 持久化，session/message ID 去重，未完成消息后续更新。
- rolling median、趋势斜率、两段 median 变化检测；分开报告 decode 下降、TTFT 增大和 429。

## 数据来源与隐私

已实测 OpenCode **1.18.29** 的 SQLite `message`、`part` 表及其 JSON data 字段；日志关联 `timestamp`、`run`、`message=process`、`messageID`、`message=stream`、`session.id`、`providerID`、`modelID`。

源数据库使用 SQLite `readOnly` 和 `query_only` 打开，不修改配置、不添加索引、不启动 OpenCode、不调用模型或外部服务。正常读取仍涉及 SQLite 读锁与 WAL 共享内存访问；权限不足时页面显示警告。

结果只写到本项目 `data/monitor.sqlite`，包含指标、会话标识、模型名、路径和简化错误类型；不复制提示词、生成正文、API key 或完整错误响应。`data/` 排除出 Git。没有遥测或上传功能。

公开参考样本的会话/消息 ID 已匿名化，默认**不导入个人调用历史**。把 `includeExampleRecords` 改为 `true` 才导入示例；之后关闭该开关不会自动删除已导入的历史。

## 指标定义

| 指标 | 定义 |
|---|---|
| 调用数 | assistant 消息数，包含未完成消息；不是精确 HTTP 次数。 |
| input | tokens.input + cache.read + cache.write。 |
| output | tokens.output（正文）+ tokens.reasoning。 |
| TTFT | 最早 reasoning/text part.time.start 减关联 stream 日志时间；无法可靠关联时留空。 |
| decode duration | 最晚输出 part.end 减最早输出 part.start。 |
| decode TPS | output / decode duration；仅完整、无 error、单 step-finish、所有输出 part 时间有效的消息可计算。 |
| E2E TPS | output /（末 part − stream）；不含进程启动退出，原测试进程口径另存。 |
| HTTP / 429 | Session error.statusCode 或错误日志明确的 status/statusCode/httpStatus/HTTP nnn。不把其他数字 429 当状态码，成功不补造 200。 |
| cost | 客户端历史报告值，不表示监控器产生费用。 |
| compaction | 明确的 part 和日志事件；多阶段可能对应同次压缩，非精确次数。 |

时间显示 UTC+8。累计 token 横轴按所选模型完整历史累计，时间过滤不归零；卡片仅汇总筛选范围。

## 参考 baseline 与判定

包含 2026-10-17 的参考测试，模型 `opencode/deepseek-v4.1-flash-free`，每档 5 条：

| Context bucket | Input 范围 | Median decode tok/s |
|---|---|---:|
| 0K | <50K，参考实际约 8.2K | 272.16 |
| 100K | 50K–300K | 259.31 |
| 500K | 300K–700K | 270.51 |
| 900K+ | ≥700K | 265.08 |

**参考环境的数据不等同于你的独立校准。** normalized TPS = 实测 TPS / 同模型同 context bucket 基准。其他模型无基准时不计算相对性能。固定基准不自动随低性能样本下降。

检测分模型运行，只使用非示例、output ≥128、无工具调用/compaction、单步且有对应基准的样本，最近最多 20 条：

- **No throttling**：未达到下列阈值；少于 10 条时注明证据不足，无基准时注明无法判断。
- **Possible throttling**：至少 10 条，normalized median <0.80，末 5 条均 <0.85。
- **Likely throttling**：至少 20 条，末 10 条至少 8 条 <0.80、中位 <0.70，且有负趋势或下降分段。

这些标签是异常强弱的启发式判断，**不能证明服务端人为限速**。TTFT 与 429 单独显示，不当成 decode 下降；参考样本自身不用于证明长期稳定。

趋势采用最近 20 条 normalized TPS 对时间的最小二乘斜率。分段检测两侧至少各 5 条，选择 median 变化最大的分界，仅展示变化 ≥20% 的结果；无需 ruptures，不是显著性检验。

## 长期运行与限制

- message/part 根据 time_updated 水位增量解析，重叠 2 秒；源表无更新时间索引时仍需扫描元数据，不向源库加索引。
- 日志保存字节偏移，每轮最多读取 8 MiB，支持尾行等待、截断/替换检测与重放去重；大日志需多轮追平。
- 停机期间从现存源文件补采；已删除日志、未持久化重试或无法关联事件可能遗漏。
- 客户端 part 时间并非逐 token wire 计时，无法拆分上传、排队、prefill、网络或缓冲。
- 宽 context 分桶仅近似校正，缓存、任务类型与负载未控制；工具和多步骤消息不参与限速判定。
- 历史数据库持续增长，不自动删除；大规模归档可限制页面时间范围。
- OpenCode 格式变化后可能需更新适配器；无数据不代表没有错误。

## 开发与许可

`node --test test.mjs` 完全离线，覆盖指标口径、参考样本、增量更新、去重、429 防误判、轮转、数据源发现和持续下降检测。GitHub Actions 在 Windows/Linux 上执行同样测试，不调用模型。

Windows 便携版包含 Node.js 24 x64，许可证位于 `runtime/LICENSE-node.txt`。项目源码采用 [MIT License](LICENSE)。
