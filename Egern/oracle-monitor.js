// 甲骨文 VPS 监控小组件（Egern generic 脚本）
// 所有私密信息都从 ctx.env 读取，不要写进本文件（仓库公开）
//
// 必填 env：
//   HOST          服务器地址
//   SSH_KEY       私钥（可用 \n 表示换行），或者
//   SSH_PASSWORD  密码（没填 SSH_KEY 时使用）
// 可选 env：
//   VIEW          显示内容：all（默认，全部）/ status（系统+节点）/ traffic（流量）/ ips（在线 IP）
//   SSH_USER      默认 egernmon
//   SSH_PORT      默认 22
//   TITLE         默认 🇯🇵 TOKYO VPS
//   MONTHLY_TB    本月出站额度（TB），默认 10
//   REFRESH       刷新间隔（秒），默认 60
//   IP_ROWS       在线 IP 最多显示几条（不填按尺寸自动）

export default async function (ctx) {
  const env = ctx.env || {};
  const host = env.HOST;
  const rawKey = env.SSH_KEY;
  const password = env.SSH_PASSWORD;

  const num = (v, d) => {
    const n = Number(v);
    return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n > 0 ? n : d;
  };

  const VIEW = String(env.VIEW || "all").toLowerCase();
  const TITLE = env.TITLE || "🇯🇵 TOKYO VPS";
  const USER = env.SSH_USER || "egernmon";
  const PORT = num(env.SSH_PORT, 22);
  const REFRESH = num(env.REFRESH, 60);
  const MONTHLY_LIMIT = num(env.MONTHLY_TB, 10) * 1e12;
  let ssh = null;

  // 颜色
  const C = {
    white: "#FFFFFF",
    gray: "#8E8E93",
    dim: "#636366",
    green: "#30D158",
    blue: "#0A84FF",
    orange: "#FF9F0A",
    red: "#FF453A",
    track: "#3A3A3C"
  };

  // 流量格式
  const shortBytes = n => {
    n = Number(n);
    if (!Number.isFinite(n) || n < 0) return "--";
    if (n >= 1e12) return (n / 1e12).toFixed(2) + " TB";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
    if (n >= 1e6) return (n / 1e6).toFixed(0) + " MB";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + " KB";
    return n.toFixed(0) + " B";
  };

  // 时间格式
  const compactDuration = n => {
    if (n === undefined || n === null || !Number.isFinite(Number(n))) {
      return "--";
    }

    n = Math.max(0, Math.floor(Number(n)));

    const d = Math.floor(n / 86400);
    const h = Math.floor(n % 86400 / 3600);
    const m = Math.floor(n % 3600 / 60);

    return d ? `${d}天${h}时` : h ? `${h}小时${m}分` : `${m}分`;
  };

  const clock = () => new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });

  // ---------- UI 基础元素 ----------
  const T = (value, size = "caption1", color = C.white, weight = "medium", extra = {}) => ({
    type: "text",
    text: String(value),
    font: { size, weight },
    textColor: color,
    maxLines: 1,
    minScale: 0.6,
    ...extra
  });

  const SP = length => length ? { type: "spacer", length } : { type: "spacer" };

  const ROW = (children, extra = {}) => ({
    type: "stack",
    direction: "row",
    alignItems: "center",
    children,
    ...extra
  });

  const COL = (children, gap = 3, extra = {}) => ({
    type: "stack",
    direction: "column",
    alignItems: "start",
    gap,
    children,
    ...extra
  });

  // 一行：左标签 + 右数值
  // 每行固定高度：Egern 的 spacer / flex 会同时吃掉竖向多余空间，
  // 不固定行高的话行距会被拉大、字会被挤小
  const LINE = 16;
  const R = (label, value, color = C.white) => ROW([
    T(label, "caption1", C.gray),
    SP(),
    T(value, "caption1", color, "semibold")
  ], { height: LINE });

  // 区块：灰色小标题 + 内容
  const S = (title, items, extra = {}) => COL([
    T(title, "footnote", C.gray, "bold"),
    ...items
  ], 3, extra);

  // 并排两列
  const TWO = (left, right, gap = 12) => ({
    type: "stack",
    direction: "row",
    alignItems: "start",
    gap,
    children: [left, right]
  });

  // 进度条
  const BAR = (pct, color) => {
    const p = Math.max(2, Math.min(100, pct));
    return {
      type: "stack",
      direction: "row",
      height: 6,
      borderRadius: 3,
      backgroundColor: C.track,
      children: [
        { type: "stack", flex: p, height: 6, borderRadius: 3, backgroundColor: color, children: [] },
        { type: "stack", flex: 100 - p, height: 6, children: [] }
      ]
    };
  };

  const widget = children => ({
    type: "widget",
    padding: 14,
    gap: 8,
    refreshAfter: new Date(Date.now() + REFRESH * 1000).toISOString(),
    children
  });

  const header = (title, right, rightColor = C.gray) => ROW([
    T(title, "headline", C.white, "bold"),
    SP(),
    T(right, "caption1", rightColor, "bold")
  ], { height: 22 });

  const error = message => widget([
    T(TITLE, "headline", C.white, "bold"),
    T("监控读取失败", "headline", C.red, "bold"),
    T(message, "caption1", "#AAAAAA", "medium", { maxLines: 4 })
  ]);

  try {
    // SSH 配置
    if (!host || (!rawKey && !password)) {
      throw new Error("缺少 SSH 环境变量（HOST + SSH_KEY / SSH_PASSWORD）");
    }

    const config = {
      host,
      port: PORT,
      username: USER,
      timeout: 20000
    };

    if (rawKey) {
      config.privateKey = rawKey.trim().replace(/\\n/g, "\n");
    } else {
      config.password = String(password);
    }

    ssh = await ctx.ssh.connect(config);

    // 只读获取系统、节点、全网卡和在线 IP 数据
    // 在线 IP 读不到时输出 null，不影响其他数据
    const cmd = `
      set -e
      export LC_ALL=C

      echo '===M==='
      curl -fsS --max-time 4 http://127.0.0.1:8765/api/monitor
      echo

      echo '===T==='
      curl -fsS --max-time 4 http://127.0.0.1:8765/api/net-total
      echo

      echo '===O==='
      curl -fsS --max-time 8 http://127.0.0.1:8765/internal/online-ips || echo null
      echo

      echo '===D==='
      date +%Y-%m-%d
    `;

    const result = await ssh.exec(cmd);

    if (result.code !== 0) {
      throw new Error(result.stderr || "读取失败");
    }

    // 解析返回数据
    const out = String(result.stdout || "");
    const marks = ["===M===", "===T===", "===O===", "===D==="];
    const pos = marks.map(x => out.indexOf(x));

    if (pos.some(x => x < 0)) {
      throw new Error("返回数据不完整");
    }

    const data = pos.map((p, i) =>
      out.slice(
        p + marks[i].length,
        i < marks.length - 1 ? pos[i + 1] : out.length
      ).trim()
    );

    const m = JSON.parse(data[0]);
    const t = JSON.parse(data[1]);
    let o = null;
    try {
      o = JSON.parse(data[2]);
    } catch (_) {
      o = null;
    }
    const date = data[3];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("服务器日期格式异常");
    }

    const currentMonth = date.slice(0, 7);

    // 全网卡累计数据
    if (!t.available) {
      throw new Error("全网卡累计流量不可用");
    }

    const totalTx = Number(t.tx);
    const totalRx = Number(t.rx);
    const totalTraffic = Number(t.total);

    if (
      !Number.isFinite(totalTx) || totalTx < 0 ||
      !Number.isFinite(totalRx) || totalRx < 0 ||
      !Number.isFinite(totalTraffic) || totalTraffic < 0
    ) {
      throw new Error("全网卡累计数据无效");
    }

    // 今日全网卡数据
    if (t.today_key !== date) {
      throw new Error("今日全网卡统计日期不匹配");
    }

    const todayTx = Number(t.today_tx);
    const todayRx = Number(t.today_rx);
    const todayTotal = Number(t.today_total);

    if (
      !Number.isFinite(todayTx) || todayTx < 0 ||
      !Number.isFinite(todayRx) || todayRx < 0 ||
      !Number.isFinite(todayTotal) || todayTotal < 0
    ) {
      throw new Error("今日全网卡数据无效");
    }

    // 本月全网卡数据
    if (t.month_key !== currentMonth) {
      throw new Error("本月全网卡统计月份不匹配");
    }

    const monthTx = Number(t.month_tx);

    if (!Number.isFinite(monthTx) || monthTx < 0) {
      throw new Error("本月上传数据无效");
    }

    // 本月出站额度
    const remaining = Math.max(0, MONTHLY_LIMIT - monthTx);
    const usedPercent = Math.min(100, monthTx / MONTHLY_LIMIT * 100);
    const quotaColor = usedPercent >= 90 ? C.red : usedPercent >= 70 ? C.orange : C.green;

    // 关闭 SSH
    await ssh.close();
    ssh = null;

    // 小组件尺寸
    const family = (ctx.widgetFamily || "").toLowerCase();
    const small = family.includes("small");
    const large = family.includes("large");

    // 系统数据
    const cpu = Number(m.cpu_percent);
    const ram = m.memory || {};
    const disk = m.disk || {};
    const pctText = v => Number.isFinite(Number(v)) ? Number(v) + "%" : "--";

    // 节点数据
    const nodes = m.node_health || {};
    const history = m.node_history || {};
    const nodeUptime = history.nodes || {};
    const online = m.hy2_online || {};

    const vless = nodes.vless_tcp === true;
    const hy2ok = nodes.hy2 === true;
    const allOK = vless && hy2ok;
    const statusText = allOK ? "● 正常" : "● 异常";
    const statusColor = allOK ? C.green : C.red;

    const vlessTime = compactDuration(nodeUptime["VLESS Reality"]?.uptime);
    const hy2Time = compactDuration(nodeUptime["Hysteria 2"]?.uptime);
    const latency = Number.isFinite(Number(m.latency_ms)) && m.latency_ms !== null
      ? Number(m.latency_ms).toFixed(2) + " ms"
      : "--";

    // 在线 IP：未识别的 VLESS 连接（多为扫描）只计数
    const ipList = o && Array.isArray(o.ips) ? o.ips : [];
    const knownIps = ipList.filter(x => !/^(未识别|\?)·/.test(String(x.label || "")));
    const unknownIps = ipList.length - knownIps.length;
    const warns = o && Array.isArray(o.warn) ? o.warn : [];
    const ipCount = o ? `${knownIps.length} 个` : "--";

    // 最近异常
    const events = Array.isArray(history.events) ? history.events : [];
    const lastEvent = events.length ? events[events.length - 1] : null;
    let eventText = "";

    if (lastEvent) {
      if (typeof lastEvent === "string") {
        eventText = lastEvent;
      } else {
        eventText = [
          lastEvent.time || lastEvent.timestamp,
          lastEvent.node || lastEvent.name,
          lastEvent.message || lastEvent.event ||
            (lastEvent.status === true
              ? "恢复正常"
              : lastEvent.status === false
                ? "检测异常"
                : "")
        ].filter(Boolean).join(" · ");
      }
    }

    // ---------- 区块 ----------
    const systemBlock = S("系统", [
      R("CPU", Number.isFinite(cpu) ? cpu.toFixed(1) + "%" : "--"),
      R("内存", `${shortBytes(ram.used)} · ${pctText(ram.percent)}`),
      R("磁盘", `${shortBytes(disk.used)} · ${pctText(disk.percent)}`),
      R("运行", compactDuration(m.uptime))
    ]);

    const nodeBlock = S("节点", [
      R("VLESS", vless ? `正常 · ${vlessTime}` : "异常", vless ? C.green : C.red),
      R("HY2", hy2ok ? `正常 · ${hy2Time}` : "异常", hy2ok ? C.green : C.red),
      R("HY2 连接", online.available ? `${online.connections} 个` : "--"),
      R("出口延迟", latency)
    ]);

    const todayBlock = S("今日", [
      R("↑ 上传", shortBytes(todayTx), C.green),
      R("↓ 下载", shortBytes(todayRx), C.blue),
      R("合计", shortBytes(todayTotal))
    ]);

    const quotaBlock = S("本月出站", [
      ROW([
        T(shortBytes(monthTx), "subheadline", C.white, "bold"),
        SP(),
        T(`${usedPercent.toFixed(1)}% / ${shortBytes(MONTHLY_LIMIT)}`, "caption2", C.gray)
      ], { height: 20 }),
      BAR(usedPercent, quotaColor),
      R("剩余", shortBytes(remaining), quotaColor)
    ]);

    const totalBlock = S("全网卡累计", [
      R("↑ TX", shortBytes(totalTx), C.green),
      R("↓ RX", shortBytes(totalRx), C.blue),
      R("合计", shortBytes(totalTraffic))
    ]);

    const eventBlock = S("最近异常", [
      T(eventText || "暂无异常记录", "caption2", eventText ? C.orange : C.gray, "medium", { maxLines: 2 })
    ]);

    // 在线 IP 行：wide=一行显示，否则两行
    const ipRow = (x, wide) => wide
      ? ROW([
          T(x.ip, "caption1", C.white, "semibold"),
          SP(),
          T(x.label || "", "caption2", C.blue, "semibold"),
          T(x.geo_short || "未知", "caption2", C.gray)
        ], { gap: 8, height: LINE })
      : COL([
          ROW([
            T(x.ip, "caption1", C.white, "semibold"),
            SP(),
            T(x.geo_short || "未知", "caption2", C.gray)
          ], { height: LINE }),
          T(x.label || "", "caption2", C.blue, "semibold")
        ], 1);

    const ipItems = (rows, wide) => {
      const items = [];
      warns.forEach(w => items.push(T(`⚠ ${w}，可能被分享`, "caption2", C.orange, "semibold")));
      if (!o) {
        items.push(T("在线 IP 读取失败", "caption2", C.gray));
      } else if (!knownIps.length) {
        items.push(T("当前没有在线用户", "caption2", C.gray));
      }
      knownIps.slice(0, rows).forEach(x => items.push(ipRow(x, wide)));
      const more = [];
      if (knownIps.length > rows) more.push(`另有 ${knownIps.length - rows} 个 IP`);
      if (unknownIps > 0) more.push(`${unknownIps} 个未识别连接`);
      if (more.length) items.push(T(more.join(" · "), "caption2", C.dim));
      return items;
    };

    const ipRowsFor = def => Math.floor(num(env.IP_ROWS, def));
    const ipBlock = (rows, wide) => S(`在线 IP（${o ? knownIps.length : "--"}）`, ipItems(rows, wide));

    const footer = T(`更新于 ${clock()} · 每 ${REFRESH} 秒`, "caption2", C.dim);

    // ---------- 视图 ----------
    // 状态：系统 + 节点（+ 在线 IP）
    if (VIEW === "status") {
      if (small) {
        return widget([
          header("TOKYO", statusText, statusColor),
          COL([
            R("CPU", Number.isFinite(cpu) ? cpu.toFixed(1) + "%" : "--"),
            R("内存", pctText(ram.percent)),
            R("VLESS", vless ? "正常" : "异常", vless ? C.green : C.red),
            R("HY2", hy2ok ? "正常" : "异常", hy2ok ? C.green : C.red),
            R("在线 IP", ipCount),
            R("延迟", latency)
          ], 3)
        ]);
      }
      const top = TWO(systemBlock, nodeBlock);
      if (large) {
        return widget([
          header(TITLE, statusText, statusColor),
          top,
          ipBlock(ipRowsFor(4), true),
          SP(),
          footer
        ]);
      }
      return widget([header(TITLE, statusText, statusColor), top]);
    }

    // 流量：今日 + 本月额度 + 累计
    if (VIEW === "traffic") {
      if (small) {
        return widget([
          header("流量", clock()),
          COL([
            R("今日", shortBytes(todayTotal)),
            R("本月出站", shortBytes(monthTx)),
            BAR(usedPercent, quotaColor),
            R("剩余", shortBytes(remaining), quotaColor),
            R("累计", shortBytes(totalTraffic))
          ], 4)
        ]);
      }
      if (large) {
        return widget([
          header(`${TITLE} · 流量`, clock()),
          quotaBlock,
          TWO(todayBlock, totalBlock),
          eventBlock,
          SP(),
          footer
        ]);
      }
      return widget([
        header("流量", clock()),
        TWO(todayBlock, quotaBlock, 14)
      ]);
    }

    // 在线 IP
    if (VIEW === "ips" || VIEW === "ip") {
      const title = `在线 IP · ${o ? knownIps.length : "--"}`;
      const right = warns.length ? "⚠ 注意" : clock();
      const rightColor = warns.length ? C.orange : C.gray;
      if (small) {
        return widget([
          header(title, ""),
          COL(ipItems(ipRowsFor(2), false), 5)
        ]);
      }
      return widget([
        header(title, right, rightColor),
        COL(ipItems(ipRowsFor(large ? 10 : 4), true), large ? 6 : 5),
        SP()
      ]);
    }

    // 全部（默认）
    if (small) {
      return widget([
        header("TOKYO", statusText, statusColor),
        COL([
          R("VLESS / HY2", allOK ? "正常" : "异常", statusColor),
          R("CPU / RAM", `${Number.isFinite(cpu) ? cpu.toFixed(1) : "--"}% / ${pctText(ram.percent)}`),
          R("今日", shortBytes(todayTotal)),
          R("本月剩余", shortBytes(remaining), quotaColor),
          R("在线 IP", ipCount)
        ], 3)
      ]);
    }

    // 中尺寸：系统 + 节点（和「状态」视图中尺寸相同）
    if (!large) {
      const nodeWithOnline = S("节点", [
        R("VLESS", vless ? `正常 · ${vlessTime}` : "异常", vless ? C.green : C.red),
        R("HY2", hy2ok ? `正常 · ${hy2Time}` : "异常", hy2ok ? C.green : C.red),
        R("在线 IP", ipCount, warns.length ? C.orange : C.white),
        R("出口延迟", latency)
      ]);
      return widget([
        header(TITLE, statusText, statusColor),
        TWO(systemBlock, nodeWithOnline)
      ]);
    }

    // 大尺寸：流量 + 在线 IP（不重复中尺寸的系统、节点信息）
    return widget([
      header(TITLE, statusText, statusColor),
      TWO(todayBlock, quotaBlock),
      ipBlock(ipRowsFor(Math.max(3, 7 - warns.length)), true),
      SP(),
      footer
    ]);

  } catch (e) {
    if (ssh) {
      try {
        await ssh.close();
      } catch (_) {}
    }

    return error(String(e?.message || e));
  }
}
