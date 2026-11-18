# QX

自用的 Quantumult X 配置片段。

| 文件 | 说明 |
| --- | --- |
| [QX](QX) | 重写（rewrite）规则，含 `hostname` 和去广告等 URL 重写 |
| [Egern/oracle-monitor.yaml](Egern/oracle-monitor.yaml) | Egern 模块：甲骨文 VPS 监控小组件（脚本 [oracle-monitor.js](Egern/oracle-monitor.js)） |
| [分流](分流) | 常用的第三方远程分流规则地址清单（滴滴、美团、阿里巴巴、支付宝、米哈游，来自 blackmatrix7/ios_rule_script） |

## 使用方法

**重写规则**：在 Quantumult X 配置的 `[rewrite_remote]` 中添加：

```ini
[rewrite_remote]
https://raw.githubusercontent.com/AT-MA/QX/main/QX, tag=QX, update-interval=86400, opt-parser=false, enabled=true
```

使用 MitM 的规则需要在 Quantumult X 里开启 MitM 并信任证书。

**分流规则**：把 [分流](分流) 里需要的地址加到 `[filter_remote]`，例如：

```ini
[filter_remote]
https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/QuantumultX/DiDi/DiDi.list, tag=滴滴, force-policy=direct, update-interval=86400, opt-parser=false, enabled=true
```

自己维护的交易所 / Emby 等分流规则在 [AT-MA/fenliu](https://github.com/AT-MA/fenliu)。

## 同步到 secret gist

仓库设为私密后，raw 链接无法订阅，所以每次推送到 main 时，[同步 Action](.github/workflows/sync-gist.yml) 会把订阅文件同步到一个 secret gist，订阅改用 gist 的链接：

```
https://gist.githubusercontent.com/AT-MA/<GIST_ID>/raw/<文件名>
```

首次设置：

1. 在 [gist.github.com](https://gist.github.com) 新建一个 **secret gist**（随便放一个文件，同步时会被清理），地址栏最后一段就是 `GIST_ID`
2. 新建一个只勾选 `gist` 权限的 token（[classic token](https://github.com/settings/tokens/new?scopes=gist&description=sync-gist)）
3. 在仓库 Settings → Secrets and variables → Actions 里：
   - **Secrets** 添加 `GIST_TOKEN` = 上面的 token
   - **Variables** 添加 `GIST_ID` = gist 的 ID
4. 到 Actions 页手动运行一次「同步到 gist」，确认 gist 里有文件后再把仓库设为私密

注意：gist 不支持目录，文件按文件名平铺，所以不同目录下不能有同名文件；文件里指向本仓库的 raw 链接会自动改成 gist 链接。

## Egern 小组件

**甲骨文 VPS 监控**：在 Egern「工具 → 模块」右上角 ＋ 添加模块，地址填：

```
https://raw.githubusercontent.com/AT-MA/QX/main/Egern/oracle-monitor.yaml
```

然后在模块编辑页的 **Env** 里填参数（密钥只填在 App 里，不要提交到仓库或 gist）：

| 变量 | 说明 |
| --- | --- |
| `HOST` | 服务器地址（必填） |
| `SSH_KEY` | 私钥，换行可写成 `\n`（和 `SSH_PASSWORD` 二选一） |
| `SSH_PASSWORD` | 密码（没填 `SSH_KEY` 时使用） |
| `SSH_USER` | 默认 `egernmon` |
| `SSH_PORT` | 默认 `22` |
| `TITLE` | 默认 `🇯🇵 TOKYO VPS` |
| `MONTHLY_TB` | 本月出站额度（TB），默认 `10` |
| `REFRESH` | 刷新间隔（秒），默认 `60` |

最后到「分析」页的小组件画廊里添加 `oracle-vps-monitor`。
