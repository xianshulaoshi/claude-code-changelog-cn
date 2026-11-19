# changelog-trigger：定时触发 update.yml 的腾讯云云函数（Python 3.13，零依赖）
# 链路见 README「自动更新 → 方案 A」。每次执行三步：
#   1. npm 门禁（GATE=0 可关闭）：npm 最新版 ≤ 仓库 docs 版本、且该版已有发布日期 → 本次跳过
#      （省 ~95% 无效 runner 启动）。任一查询失败一律放行触发（fail-open，宁多跑不漏更新）。
#   2. 自愈 enable：PUT .../actions/workflows/update.yml/enable（幂等：204=刚启用，409=本就启用），
#      防 GitHub 对 60 天无活动仓库自动禁用整个 workflow（含 workflow_dispatch）导致 dispatch 403。
#   3. dispatch：POST .../dispatches（ref=main）；非 204 主动抛错 → 配合 SCF 云监控「调用错误」告警即可发现断链。
# 环境变量：GH_PAT 必填（GitHub 细粒度 PAT：本仓库 Actions 读写；建议加勾 Contents 只读——npm 门禁靠 /commits 比对
#           docs 版本，缺该权限时自动匿名重试/放行。注意 SCF 环境变量为明文存储，勿外开查看权限）
#           REPO / WORKFLOW / BRANCH / GATE 可选，默认值见下
import json
import os
import re
import urllib.error
import urllib.request

GH_PAT = os.environ.get('GH_PAT', '')
GH_API = os.environ.get('GH_API', 'https://api.github.com')
REPO = os.environ.get('REPO', 'xianshulaoshi/claude-code-changelog-cn')
WORKFLOW = os.environ.get('WORKFLOW', 'update.yml')
BRANCH = os.environ.get('BRANCH', 'main')
GATE = os.environ.get('GATE', '1') != '0'
NPM_LATEST = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
RAW = f'https://raw.githubusercontent.com/{REPO}/{BRANCH}'
UA = 'changelog-trigger (SCF timer)'


def http(method, url, headers=None, body=None, timeout=10):
    req = urllib.request.Request(url, method=method, data=body)
    req.add_header('User-Agent', UA)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def gh(method, path, body=None):
    headers = {
        'Authorization': f'Bearer {GH_PAT}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    return http(method, f'{GH_API}{path}', headers, data)


def ver_key(v):
    """版本号比较键：数字段按数值、非数字段按字符串（'2.1.9' < '2.1.10'）。"""
    return [((0, int(p)) if p.isdigit() else (1, p)) for p in v.strip().lstrip('vV').split('.')]


def gate_need_update():
    """门禁：返回 (是否需要触发, 原因)。查询失败时放行（fail-open）。"""
    try:
        _, raw = http('GET', NPM_LATEST)
        npm = json.loads(raw)['version']
    except Exception as e:  # noqa: BLE001 —— 门禁任何失败都放行，由 workflow 内部门禁兜底
        return True, f'gate: npm 查询失败({e})，放行'
    try:
        try:
            _, raw = gh('GET', f'/repos/{REPO}/commits?path=docs/versions&per_page=1')
        except urllib.error.HTTPError as e:
            # 细粒度 PAT 未勾 Contents:read 时此处 401/403 —— 公开仓库匿名重试（速率有限但有兜底）
            if e.code not in (401, 403):
                raise
            _, raw = http('GET', f'{GH_API}/repos/{REPO}/commits?path=docs/versions&per_page=1',
                          {'Accept': 'application/vnd.github+json'})
        msg = json.loads(raw)[0]['commit']['message']
        m = re.search(r'自动更新至 v([0-9A-Za-z.+\-]+)', msg)
        if not m:
            raise ValueError(f'最近 docs 提交无版本号：{msg[:60]!r}')
        docs_ver = m.group(1)
    except Exception as e:  # noqa: BLE001
        return True, f'gate: docs 版本解析失败({e})，放行'
    if ver_key(npm) > ver_key(docs_ver):
        return True, f'gate: npm {npm} > docs {docs_ver}'
    try:
        _, raw = http('GET', f'{RAW}/docs/versions/{docs_ver}.md')
        if '🗓' not in raw.decode('utf-8', 'ignore'):
            return True, f'gate: docs {docs_ver} 缺发布日期，待补全'
    except Exception as e:  # noqa: BLE001
        return True, f'gate: 发布日期检查失败({e})，放行'
    return False, f'gate: docs {docs_ver} = npm {npm} 且日期齐全，跳过本次'


def main_handler(event, context):  # noqa: ARG001 —— SCF 定时触发入口
    if not GH_PAT:
        raise RuntimeError('缺少环境变量 GH_PAT（GitHub 细粒度 PAT）')
    if GATE:
        need, why = gate_need_update()
        print(why)
        if not need:
            return {'status': 0, 'msg': why}
    # 自愈 enable：幂等；失败仅告警不阻断（409=本就已启用）
    try:
        st, _ = gh('PUT', f'/repos/{REPO}/actions/workflows/{WORKFLOW}/enable')
        print(f'enable: {st}')
    except urllib.error.HTTPError as e:
        if e.code != 409:
            print(f'enable 警告(不阻断): HTTP {e.code}')
    except Exception as e:  # noqa: BLE001 —— 网络抖动等也不阻断，继续 dispatch
        print(f'enable 警告(不阻断): {e}')
    # dispatch：204 = 已触发；其余抛错让本次调用标记为失败（供云监控告警）
    try:
        st, _ = gh('POST', f'/repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches', {'ref': BRANCH})
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'dispatch 失败: HTTP {e.code} {e.read()[:200]!r}') from e
    print(f'dispatch: {st}')
    return {'status': st, 'msg': 'triggered'}
