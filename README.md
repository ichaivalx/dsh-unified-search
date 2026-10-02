# DSH Unified Search

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 接入 Tavily、Exa 和 Firecrawl，提供统一的 `web_search` 和 `web_fetch` 工具。

## 支持的服务

| 服务 | 搜索 | 网页正文读取 |
| --- | --- | --- |
| Tavily | Search | Extract |
| Exa | Search | Contents |
| Firecrawl | Search | Scrape |

## 功能

- 在 DSH 插件页面配置各家服务的搜索档位和正文读取选项。
- 分别设置搜索、正文读取的默认服务，模型也可通过 `provider` 参数选择。
- 支持多 API Key 轮询与主备，密钥保存在 DSH 凭据库。
- 支持结果数量、域名和时间筛选，以及可选的输出字符上限。
- 支持子代理和 PTC 调用。

## 安装与配置

1. 从 [Releases](https://github.com/ichaivalx/dsh-unified-search/releases) 下载 `.tgz` 安装包。
2. 在 DSH「插件 → 添加插件」中填写安装包的绝对路径并安装。
3. 打开「已安装 → unified-search」，配置 API Key 和默认服务。

也可通过 YAML 配置，参见 [settings.example.yaml](./settings.example.yaml)。

适配 DeepSeek Harness `0.2.0-rc.2`。

## 许可证

[MIT](./LICENSE)
