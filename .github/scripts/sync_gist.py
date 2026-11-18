#!/usr/bin/env python3
"""把仓库里的订阅文件同步到一个 secret gist。

- 同步 git 跟踪的所有文件，排除 README.md、CLAUDE.md 和 .github/
- gist 不支持目录，文件按文件名平铺（重名会报错）
- 文件内容里指向本仓库的 raw 链接会改写成 gist 的 raw 链接
- 仓库里已删除的文件，gist 里也会删除

环境变量：GIST_TOKEN（有 gist 权限的 token）、GIST_ID；
DRY_RUN=1 时只打印要同步的内容，不调用 API。
"""
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

EXCLUDE = {"README.md", "CLAUDE.md"}
API = "https://api.github.com/gists/"


def api(method, gist_id, token, body=None):
    req = urllib.request.Request(
        API + gist_id,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def main():
    token = os.environ.get("GIST_TOKEN", "")
    gist_id = os.environ.get("GIST_ID", "")
    dry_run = os.environ.get("DRY_RUN") == "1"
    if not dry_run and (not token or not gist_id):
        print("::warning::没有设置 GIST_TOKEN 或 GIST_ID，跳过同步")
        return

    owner, repo = os.environ["GITHUB_REPOSITORY"].split("/")
    out = subprocess.check_output(["git", "ls-files", "-z"]).decode()
    paths = [
        p for p in out.split("\0")
        if p and p not in EXCLUDE and not p.startswith(".github/")
    ]

    names = {}
    for p in paths:
        name = os.path.basename(p)
        if name in names:
            sys.exit(f"::error::文件名重复，gist 里无法区分：{names[name]} 和 {p}")
        names[name] = p

    if dry_run:
        gist_owner, existing = owner, set()
        gist_id = gist_id or "GIST_ID"
    else:
        gist = api("GET", gist_id, token)
        gist_owner = gist["owner"]["login"]
        existing = set(gist["files"])

    raw_base = f"https://gist.githubusercontent.com/{gist_owner}/{gist_id}/raw/"
    path_to_name = {p: n for n, p in names.items()}
    link_re = re.compile(
        rf"https://raw\.githubusercontent\.com/{re.escape(owner)}/{re.escape(repo)}/main/([^\s'\"<>)]+)",
        re.IGNORECASE,
    )

    def rewrite(m):
        path = urllib.parse.unquote(m.group(1))
        name = path_to_name.get(path)
        return raw_base + urllib.parse.quote(name) if name else m.group(0)

    files = {}
    for name, p in names.items():
        with open(p, encoding="utf-8") as f:
            content = link_re.sub(rewrite, f.read())
        if content.strip():  # gist 不允许空文件
            files[name] = {"content": content}
    for name in existing - set(files):
        files[name] = None  # 删除 gist 里多余的文件

    for name, v in sorted(files.items()):
        print(("删除  " if v is None else "同步  ") + name, "" if v is None else raw_base + urllib.parse.quote(name))
    if dry_run:
        return
    api("PATCH", gist_id, token, {"files": files})
    print("完成")


if __name__ == "__main__":
    main()
