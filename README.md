# DSH Unified Search

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 接入 Tavily、Exa 和 Firecrawl，向模型提供统一的 `web_search` 与 `web_fetch`，并在 DSH 插件页面中管理配置和 API 密钥。

这是独立的社区插件，不是 DeepSeek 或搜索服务商的官方产品。无需修改 DSH 源码，也无需为这三家服务分别启动 MCP 服务。

## 功能

- **两个工具，三家服务**：模型通过可选的 `provider` 参数切换服务；每次调用只请求一家。
- **独立默认值**：搜索和网页正文读取可以使用不同的默认服务。
- **原生配置页面**：Tavily / Exa / Firecrawl 标签页，支持搜索档位、正文读取选项、请求期限与输出设置。
- **多密钥**：支持轮询和主备；密钥保存在 DSH 自带凭据库，配置中只保存引用名称。
- **默认保留上游内容**：不预设搜索结果数量，不额外截断摘要或正文；需要时可填写限制。
- **支持子代理和 PTC**：使用 DSH 现有工具机制，原生调用与 PTC 共用同一套实现。

| 服务 | 搜索 | 单页正文读取 |
| --- | --- | --- |
| Tavily | Search：`basic` / `advanced` / `fast` / `ultra-fast` | Extract：`basic` / `advanced` |
| Exa | Search：`instant` / `fast` / `auto` / `deep-lite` / `deep` / `deep-reasoning` | Contents：正文与缓存时效 |
| Firecrawl | Search：网页结果，可开启 highlights | Scrape：Markdown，可只保留正文 |

`web_fetch` 读取指定 URL 的单页内容。插件不提供整站 Crawl、Map、结构化 Extract、Answer、Research 或云端 Agent 任务；Exa 的 `deep-reasoning` 走 Search API。

## 安装与配置

已在 **DeepSeek Harness `0.1.6-alpha.2`**（上游提交 `ddefc45fbc7f8e46dd73185e68295696d1297887`）上验证。DSH 仍处于 alpha 阶段，其他版本的插件接口可能有所不同。

1. 从 [Releases](https://github.com/ichaivalx/dsh-unified-search/releases) 下载 `ichaival-dsh-unified-search-1.1.2.tgz`。
2. 在 DSH 的「插件 → 添加插件」中填写该文件的绝对路径并安装。也可使用 DSH CLI：

   ```sh
   dsh plugin --profile desktop add ./ichaival-dsh-unified-search-1.1.2.tgz
   ```

   使用其他 profile 时，将 `desktop` 替换成对应名称。

3. 确认插件已启用，打开「已安装 → unified-search」配置默认服务和密钥。如果没有出现配置页面，重启 DSH 后重新打开。

发布包已包含前端构建产物，使用者无需安装开发依赖或自行编译。运行时使用当前 DSH 已有的 Cordis、Schemastery、Tools、Credentials，不需要全局依赖。仓库保留了 `lib/`，也可直接从 Git 安装；没有安装时自动执行的构建脚本。

若此前接入了同类 MCP，可自行停用重复的搜索工具；本插件不会修改其他插件或你的 `AGENTS.md`。原本不提供联网工具的极简预设仍保持不变。

在 DSH「插件管理 → 已安装 → unified-search」直接配置：上方分别选择默认搜索服务与默认网页正文读取服务，下面通过 Tavily、Exa、Firecrawl 标签页切换。参数控件按内容宽度排列，枚举选项显示原始值；跨标签切换保留未保存的草稿。API 密钥和高级选项可折叠。网页正文读取对应 Extract / Contents / Scrape，只处理指定单页，不是整站 Crawl。

页面支持添加、替换、启停和移除多个密钥引用，密钥值只写入官方凭据库。默认引用名为 `TAVILY_API_KEY`、`EXA_API_KEY`、`FIRECRAWL_API_KEY`，可更改名称。移除只断开插件引用，不删除共享凭据。未保存修改作为草稿保留；「取消更改」恢复当前已保存配置，不撤销已经写入凭据库的值。若密钥已保存而配置保存失败，会显示部分成功并保留未完成草稿。

页面保存只提交编辑过的字段，并使用版本号防止覆盖外部 YAML 修改。发生冲突时，可丢弃草稿载入最新值，或保留自己的改动、重新检查后保存；后者仅让自己编辑过的字段优先。未编辑字段与未识别字段不会被整段替换。

也可参照 [settings.example.yaml](./settings.example.yaml) 编辑 DSH `settings.yaml` 的 `unified-search` 段；未填写的选项使用示例中的默认值。配置通过官方 settings 服务实时读取，下一次调用生效，进行中的请求保留开始时的设置。

每家服务可配置多条 `keys: [{ref, enabled}]`。`round-robin` 在并发请求之间轮换起始 key，`failover` 每次优先第一把。仅明确的认证、额度或限流错误（HTTP 401/402/429，及 Tavily 432/433）才切下一把；每次请求同一实际 key 最多尝试一次。缺失的凭据引用跳过。网络失败、超时、一般 4xx/5xx 不自动重试，避免重复计费；不自动改用另一家 provider。HTTP 403 不预设为 key 错误。

## 模型工具

插件会注册工具说明、参数定义和使用提示，无需另外编写使用教程。省略 `provider` 时，分别使用你设置的默认搜索服务或默认正文读取服务。

```js
web_search({query: "最新信息"})
web_search({query: "官方说明", provider: "exa", maxResults: 5,
  includeDomains: ["example.com/docs"], timeRange: "week"})
web_fetch({url: "https://example.com/article"})
```

搜索只有 `query` 必填，另有 `provider`、`maxResults`、`includeDomains`、`excludeDomains`、`timeRange`。抓取只有 `url` 必填，另有 `provider`。

可以直接告诉模型“这次优先用 Exa 搜索”。插件本身不写死 Tavily → Exa 的回退顺序；如果自己的全局或项目提示词已有服务商偏好，需要自行与界面默认值保持一致。搜索档位、缓存选项、密钥策略和超时由用户配置，模型不会通过工具参数修改这些设置。

- 默认搜索 Tavily advanced；默认抓取 Firecrawl scrape。Exa 默认 Search API 的 `deep-reasoning`。Firecrawl 搜索只使用 Search 的 web 来源，不附带批量抓取，不调用 Research/Agent。
- 默认结果数、每条摘要字符上限、正文字符上限默认均为空，YAML 可省略或写 `null`，UI 清空后保存 `null`。`maxResults` 留空时不向上游传数量参数，也不裁剪返回列表；明确填写才作为默认数量。模型显式传入的 `maxResults` 优先于 YAML 默认值，Tavily 范围 0–20，Exa/Firecrawl 范围 1–100。
- Tavily 域名名单最多包含 300 条、排除 150 条；Exa 各 1200 条且支持域名路径和通配子域。Firecrawl 只接受主机名，包含与排除名单互斥。无明确官方数量上限的地方不额外限制；不支持的输入在发送前明确报错。
- `timeRange`：day/week/month/year。Tavily 使用其发布时间/更新日期规则，可能保留没有检测到日期的来源；Exa 转换为发布时间下界，按 UTC 日历减月/年并将月底夹到目标月末；Firecrawl 使用对应 `qdr` 搜索时间条件。三家的时间语义并不完全相同。
- 搜索返回 `provider`、`results[{provider,title,url,snippet,publishedAt?,truncated,originalChars}]`、`usage`、`truncated`。抓取返回来源 URL、标题、正文 `content`、格式、截断信息及 usage。usage 只提供供应商实际返回的 credits/cost/request ID/耗时；没有的字段不估造。Exa cost 是服务端成本估计，不是最终账单。
- `snippetMaxChars` 与 `fetchMaxChars` 留空时保留服务商返回的完整相关摘要/正文，只有明确填写正整数才做本地字符截断，并显式标记。字符上限使用 JavaScript 字符串长度，不是 token 数。服务商自身的摘录/提取规则以及 DSH 后续长输出转存、上下文压缩仍适用，留空不保证模型单次直接看到全部网页。PTC 获取结构化对象和完整返回类型，普通工具调用显示可读的原文与链接。

## 生命周期

利用公开 `agent/created`，在 agent 自己的 scope 中覆盖继承的同名工具及提示段。DSH preset 在此事件前已组装，所有子 agent 均适用。原本没有联网工具的 minimal preset 保持不变；空白会话切换 preset 后通过公开 `agent-preset/selected` 重新判断。安装时正在运行的既有 agent 等自身 idle 后再替换 schema，避免半途更换参数。插件卸载或 agent 销毁会撤销注册；卸载取消此插件正在执行的请求并恢复原工具。

## 开发与测试

客户端用项目局部 esbuild 构建：安装锁文件中的开发依赖后运行 `npm run build`。产物 `lib/client.js` 遵循 DSH 官方 lazy-CJS factory 格式，React、UI primitives、store 均由 DSH 平台提供，不内联第二套实例。生产安装直接使用随包提供的产物，无须重建客户端。

```sh
npm ci
npm run build
```

运行 `npm test`（Node 22.17+，同时满足所用 DSH 版本的运行时要求），设置 `DSH_RUNTIME_ANCHOR` 为已安装 DSH 运行时的 `package.json` 绝对路径，再用其运行时执行测试。先执行 `npm run build` 生成测试所需的 `.build/` 数据。若依赖位于 `app.asar`，使用对应 Electron 并仅对测试进程设置 `ELECTRON_RUN_AS_NODE=1`，例如在 PowerShell 中：

```powershell
$previousElectronMode = $env:ELECTRON_RUN_AS_NODE
$previousAnchor = $env:DSH_RUNTIME_ANCHOR
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:DSH_RUNTIME_ANCHOR = 'C:/path/to/DeepSeek Harness/resources/app.asar/dsh/package.json'
    & 'C:/path/to/DeepSeek Harness/DeepSeek Harness.exe' --import ./test/runtime-loader.js --test 'test/*.test.js' | Out-Host
} finally {
    if ($null -eq $previousElectronMode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $previousElectronMode }
    if ($null -eq $previousAnchor) { Remove-Item Env:DSH_RUNTIME_ANCHOR -ErrorAction SilentlyContinue }
    else { $env:DSH_RUNTIME_ANCHOR = $previousAnchor }
}
```

将示例路径替换成自己的安装位置；全部通过时，测试汇总显示 `fail 0`。测试 loader 不属于发布包，也不要将它配成生产 loader。

测试使用模拟 HTTP 和虚构凭据，不发送付费请求。除各服务参数/结果、轮换、失败/取消、配置热更外，集成测试使用实际安装版 DSH Tools、SystemPrompt、scope 和 settings 服务，验证原生 schema/执行、PTC SDK/执行、子 agent、minimal、preset 切换及卸载恢复。UI 测试覆盖仅保存改动字段、外部冲突、多密钥、保存失败及部分成功保留草稿，并通过实际安装版客户端模块加载器加载构建产物。

API 对照：[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)、[Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)、[Exa Search](https://exa.ai/docs/reference/search)、[Contents](https://exa.ai/docs/reference/get-contents)、[Firecrawl Search](https://docs.firecrawl.dev/api-reference/endpoint/search)、[Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape)。

发布前先构建，然后打包：

```sh
npm pack --pack-destination releases
```

`releases/` 保存本地安装包，不纳入 Git；分发包通过 GitHub Releases 提供。

## 许可证

[MIT](./LICENSE)。
