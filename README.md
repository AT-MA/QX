# QX

自用的 Quantumult X 配置片段。

| 文件 | 说明 |
| --- | --- |
| [QX](QX) | 重写（rewrite）规则，含 `hostname` 和去广告等 URL 重写 |
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
