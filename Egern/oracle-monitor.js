// 甲骨文 VPS 监控小组件（Egern generic 脚本）
// 所有私密信息都从 ctx.env 读取，不要写进本文件（仓库公开）
//
// 必填 env：
//   HOST          服务器地址
//   SSH_KEY       私钥（可用 \n 表示换行），或者
//   SSH_PASSWORD  密码（没填 SSH_KEY 时使用）
// 可选 env：
//   SSH_USER      默认 egernmon
//   SSH_PORT      默认 22
//   TITLE         默认 🇯🇵 TOKYO VPS
//   MONTHLY_TB    本月出站额度（TB），默认 10
//   REFRESH       刷新间隔（秒），默认 60

export default async function (ctx) {
  const env = ctx.env || {};
  const host = env.HOST;
  const rawKey = env.SSH_KEY;
  const password = env.SSH_PASSWORD;

  const num = (v, d) => {
    const n = Number(v);
    return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n > 0 ? n : d;
  };

  const TITLE = env.TITLE || "🇯🇵 TOKYO VPS";
  const USER = env.SSH_USER || "egernmon";
  const PORT = num(env.SSH_PORT, 22);
  const REFRESH = num(env.REFRESH, 60);
  const MONTHLY_LIMIT = num(env.MONTHLY_TB, 10) * 1e12;
  let ssh = null;

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

  // UI 文本
  const T = (
    value,
    size = "caption1",
    color = "#FFFFFF",
    weight = "medium"
  ) => ({
    type: "text",
    text: String(value),
    font: { size, weight },
    textColor: color
  });

  const R = (label, value, color = "#FFFFFF") => ({
    type: "stack",
    direction: "row",
    children: [
      T(label, "caption1", "#999999"),
      { type: "spacer" },
      T(value, "caption1", color, "semibold")
    ]
  });

  const S = (title, items) => ({
    type: "stack",
    direction: "column",
    gap: 3,
    children: [
      T(title, "subheadline", "#FFFFFF", "bold"),
      ...items
    ]
  });

  const widget = children => ({
    type: "widget",
    padding: 12,
    gap: 6,
    refreshAfter: new Date(
      Date.now() + REFRESH * 1000
    ).toISOString(),
    children
  });

  const error = message => widget([
    T(TITLE, "headline", "#FFFFFF", "bold"),
    T("监控读取失败", "headline", "#FF453A", "bold"),
    T(message, "caption1", "#AAAAAA")
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

    // 只读获取系统、节点和全网卡数据
    const cmd = `
      set -e
      export LC_ALL=C

      echo '===M==='
      curl -fsS --max-time 4 http://127.0.0.1:8765/api/monitor
      echo

      echo '===T==='
      curl -fsS --max-time 4 http://127.0.0.1:8765/api/net-total
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
    const marks = ["===M===", "===T===", "===D==="];
    const pos = marks.map(x => out.indexOf(x));

    if (pos.some(x => x < 0)) {
      throw new Error("返回数据不完整");
    }

    const data = pos.map((p, i) =>
      out.slice(
        p + marks[i].length,
        i < 2 ? pos[i + 1] : out.length
      ).trim()
    );

    const m = JSON.parse(data[0]);
    const t = JSON.parse(data[1]);
    const date = data[2];

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
    const remaining = Math.max(
      0,
      MONTHLY_LIMIT - monthTx
    );

    const usedPercent = Math.min(
      100,
      monthTx / MONTHLY_LIMIT * 100
    );

    // 关闭 SSH
    await ssh.close();
    ssh = null;

    // 小组件尺寸
    const family = (ctx.widgetFamily || "").toLowerCase();
    const small = family.includes("small");
    const large = family.includes("large") ||
                  family.includes("extralarge");

    // 系统数据
    const cpu = Number(m.cpu_percent);
    const ram = m.memory || {};
    const disk = m.disk || {};

    // 节点数据
    const nodes = m.node_health || {};
    const history = m.node_history || {};
    const nodeUptime = history.nodes || {};
    const online = m.hy2_online || {};

    const vless = nodes.vless_tcp === true;
    const hy2ok = nodes.hy2 === true;
    const allOK = vless && hy2ok;

    const statusColor = allOK
      ? "#30D158"
      : "#FF453A";

    const vlessTime = compactDuration(
      nodeUptime["VLESS Reality"]?.uptime
    );

    const hy2Time = compactDuration(
      nodeUptime["Hysteria 2"]?.uptime
    );

    // 顶部状态
    const header = {
      type: "stack",
      direction: "row",
      children: [
        T(TITLE, "headline", "#FFFFFF", "bold"),
        { type: "spacer" },
        T(
          allOK ? "● 正常" : "● 异常",
          "subheadline",
          statusColor,
          "bold"
        )
      ]
    };

    // 系统
    const system = S("系统", [
      R(
        "CPU",
        Number.isFinite(cpu) ? cpu.toFixed(1) + "%" : "--"
      ),
      R(
        "内存",
        `${shortBytes(ram.used)} · ${Number.isFinite(Number(ram.percent)) ? ram.percent + "%" : "--"}`
      ),
      R(
        "磁盘",
        `${shortBytes(disk.used)} · ${Number.isFinite(Number(disk.percent)) ? disk.percent + "%" : "--"}`
      ),
      R("运行时间", compactDuration(m.uptime))
    ]);

    // 节点状态：保留健康检测，不统计节点流量
    const nodesBlock = S("节点状态", [
      R(
        "VLESS",
        vless ? "正常" : "异常",
        vless ? "#30D158" : "#FF453A"
      ),
      R("VLESS 正常", vlessTime),
      R(
        "HY2",
        hy2ok ? "正常" : "异常",
        hy2ok ? "#30D158" : "#FF453A"
      ),
      R("HY2 正常", hy2Time),
      R(
        "HY2 在线",
        online.available
          ? `${online.connections} 个`
          : "--"
      ),
      R(
        "出口延迟",
        m.latency_ms !== undefined &&
        m.latency_ms !== null &&
        Number.isFinite(Number(m.latency_ms))
          ? Number(m.latency_ms).toFixed(2) + " ms"
          : "--"
      )
    ]);

    // 今日总用量
    const today = S("今日总用量", [
      R("↑ 上传", shortBytes(todayTx), "#30D158"),
      R("↓ 下载", shortBytes(todayRx), "#0A84FF"),
      R("合计", shortBytes(todayTotal), "#FFFFFF")
    ]);

    // 全网卡历史累计
    const total = S("全网卡累计", [
      R("↑ TX", shortBytes(totalTx), "#30D158"),
      R("↓ RX", shortBytes(totalRx), "#0A84FF"),
      R("合计", shortBytes(totalTraffic), "#FFFFFF")
    ]);

    // 本月出站额度
    const quota = S("本月出站额度", [
      R("已用", shortBytes(monthTx)),
      R("剩余", shortBytes(remaining), "#30D158"),
      R("使用率", usedPercent.toFixed(1) + "%")
    ]);

    // 最近异常记录
    const events = Array.isArray(history.events)
      ? history.events
      : [];

    const lastEvent = events.length
      ? events[events.length - 1]
      : null;

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

    const historyBlock = S("最近异常", [
      T(
        eventText || "暂无异常记录",
        "caption2",
        eventText ? "#FF9F0A" : "#999999"
      )
    ]);

    // 小尺寸
    if (small) {
      return widget([
        header,
        R(
          "VLESS / HY2",
          allOK ? "正常" : "异常",
          statusColor
        ),
        R(
          "CPU / RAM",
          `${Number.isFinite(cpu) ? cpu.toFixed(1) : "--"}% / ${ram.percent ?? "--"}%`
        ),
        R(
          "今日总用量",
          shortBytes(todayTotal)
        ),
        R(
          "累计流量",
          shortBytes(totalTraffic)
        ),
        R(
          "本月剩余",
          shortBytes(remaining),
          "#30D158"
        )
      ]);
    }

    // 最大尺寸：双列布局
    if (large) {
      const left = {
        type: "stack",
        direction: "column",
        gap: 8,
        children: [
          system,
          nodesBlock
        ]
      };

      // 右侧最终顺序
      const right = {
        type: "stack",
        direction: "column",
        gap: 8,
        children: [
          today,
          total,
          quota,
          historyBlock
        ]
      };

      return widget([
        header,
        {
          type: "stack",
          direction: "row",
          gap: 6,
          children: [
            left,
            right
          ]
        },
        T(
          `每 ${REFRESH} 秒请求刷新 · ` +
          new Date().toLocaleTimeString(
            "zh-CN",
            { hour12: false }
          ),
          "caption2",
          "#888888"
        )
      ]);
    }

    // 中尺寸
    return widget([
      header,
      system,
      nodesBlock,
      today,
      total,
      quota,
      historyBlock
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
