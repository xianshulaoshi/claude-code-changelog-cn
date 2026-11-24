#!/usr/bin/env python3
"""scf-trigger/index.py 的单元测试：只用标准库，全程不发真实网络请求，也不会派发任何 workflow。

运行（仓库根目录）：

    python3 -B -m unittest discover -s scf-trigger -p 'test_*.py'

覆盖三块：

- GateTests：门禁三态判定（update / deploy / skip）的每个分支，含各类查询失败时的 fail-open。
- HandlerTests：动作到派发目标的对应、自愈 enable 的容错、dispatch 失败必须抛错。
- WireTests：不替换 http() / gh()，只打桩最底层的 urlopen，验证真实请求的形态与异常类型。
"""
import contextlib
import importlib.util
import io
import json
import os
import socket
import sys
import unittest
import urllib.error
import urllib.request
from unittest import mock

sys.dont_write_bytecode = True  # 不在仓库里留 __pycache__/

INDEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.py')
ENV_KEYS = ('GH_PAT', 'GH_API', 'REPO', 'WORKFLOW', 'DEPLOY_WORKFLOW', 'BRANCH', 'GATE', 'SITE')
DEFAULT_SITE = 'https://xianshulaoshi.github.io/claude-code-changelog-cn'
GOOD_MD = '# v\n\n> 🗓 2026-11-23 发布\n'.encode('utf-8')
NO_DATE_MD = '# v\n\n正文\n'.encode('utf-8')
OTHER_MD = '# v\n\n> 🗓 内容不同\n'.encode('utf-8')


def load(env=None):
    """按给定环境变量加载 index.py（GH_PAT / GATE 等是导入时读入的模块常量），结束后恢复原环境。"""
    saved = {k: os.environ.get(k) for k in ENV_KEYS}
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    os.environ.update(env or {})
    try:
        spec = importlib.util.spec_from_file_location('changelog_trigger', INDEX)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


_OPEN_ERRORS = []  # 测试里造出的 HTTPError；被测代码接住后不会关闭，统一在模块结束时关掉，免得留下 ResourceWarning


def http_error(code, body=b'{"message": "nope"}'):
    error = urllib.error.HTTPError('https://x.test', code, 'err', {}, io.BytesIO(body))
    _OPEN_ERRORS.append(error)
    return error


def tearDownModule():
    for error in _OPEN_ERRORS:
        error.close()
    del _OPEN_ERRORS[:]


def commits_path(mod):
    return '/repos/{}/commits?path=docs/versions&per_page=1'.format(mod.REPO)


def quiet():
    """吞掉被测函数的 print，保持测试输出干净。"""
    return contextlib.redirect_stdout(io.StringIO())


class FakeNet:
    """假网络：替换 index.py 的 http() / gh()，按 URL 路由并记录全部调用。

    各响应属性设为异常实例即抛出该异常。gh_commits / anon_commits 是最近一次 docs 提交的标题。
    """

    def __init__(self, npm='2.1.331', docs_ver='2.1.331', gh_commits=None, anon_commits=None,
                 repo_md=GOOD_MD, site_md=GOOD_MD, enable=None, dispatch=None):
        self.npm, self.docs_ver = npm, docs_ver
        commit_msg = 'docs: 自动更新至 v{}（x）'.format(docs_ver)
        self.gh_commits = commit_msg if gh_commits is None else gh_commits
        self.anon_commits = commit_msg if anon_commits is None else anon_commits
        self.repo_md, self.site_md = repo_md, site_md
        self.enable, self.dispatch = enable, dispatch
        self.calls = []

    def install(self, mod):
        self.mod = mod
        mod.http, mod.gh = self.http, self.gh

    @staticmethod
    def _either(value, ok):
        if isinstance(value, Exception):
            raise value
        return ok(value)

    def http(self, method, url, headers=None, body=None, timeout=10):
        self.calls.append(('http', method, url))
        m = self.mod
        if url == m.NPM_LATEST:
            return self._either(self.npm, lambda v: (200, json.dumps({'version': v}).encode('utf-8')))
        if url == m.GH_API + commits_path(m):
            return self._either(self.anon_commits, self._commit_list)
        if url == '{}/docs/versions/{}.md'.format(m.RAW, self.docs_ver):
            return self._either(self.repo_md, lambda v: (200, v))
        if url == '{}/versions/{}.md'.format(m.SITE, self.docs_ver):
            return self._either(self.site_md, lambda v: (200, v))
        raise AssertionError('意外的请求：{} {}'.format(method, url))

    def gh(self, method, path, body=None):
        self.calls.append(('gh', method, path, body))
        if path == commits_path(self.mod):
            return self._either(self.gh_commits, self._commit_list)
        if path.endswith('/enable'):
            return self._either(self.enable, lambda v: (204, v))
        if path.endswith('/dispatches'):
            return self._either(self.dispatch, lambda v: (204, v))
        raise AssertionError('意外的请求：{} {}'.format(method, path))

    @staticmethod
    def _commit_list(message):
        return 200, json.dumps([{'commit': {'message': message}}]).encode('utf-8')

    def reads(self):
        return [c for c in self.calls if not (c[0] == 'gh' and c[1] in ('PUT', 'POST'))]

    def writes(self):
        return [c for c in self.calls if c[0] == 'gh' and c[1] in ('PUT', 'POST')]


def wired(env=None, **net_kwargs):
    """加载 index.py 并接上假网络，返回 (模块, 假网络)。"""
    mod = load(env)
    net = FakeNet(**net_kwargs)
    net.install(mod)
    return mod, net


class GateTests(unittest.TestCase):
    def decide(self, **net_kwargs):
        mod, net = wired({'GH_PAT': 'pat'}, **net_kwargs)
        return mod.gate_decide(), net, mod

    def test_in_sync_skips(self):
        (action, why), net, mod = self.decide()
        self.assertEqual(action, 'skip')
        self.assertIn('线上已同步', why)
        # 依次读 npm → commits → 仓库文件 → 线上文件，不多不少
        self.assertEqual([c[2] for c in net.reads()], [
            mod.NPM_LATEST,
            commits_path(mod),
            '{}/docs/versions/2.1.331.md'.format(mod.RAW),
            '{}/versions/2.1.331.md'.format(mod.SITE),
        ])

    # —— 判定为 update：仓库侧需要重新翻译 ——
    def test_new_npm_version_triggers_update_without_probing_site(self):
        (action, why), net, _ = self.decide(npm='2.1.332')
        self.assertEqual(action, 'update')
        self.assertIn('npm 2.1.332 > docs 2.1.331', why)
        self.assertFalse(any(c[2].startswith(net.mod.SITE) for c in net.reads()))

    def test_missing_release_date_triggers_update(self):
        (action, why), _, _ = self.decide(repo_md=NO_DATE_MD)
        self.assertEqual(action, 'update')
        self.assertIn('缺发布日期', why)

    def test_docs_ahead_of_npm_still_checks_the_site(self):  # docs 领先 npm（如内测版）时同样要确认线上
        (action, _), _, _ = self.decide(npm='2.1.330')
        self.assertEqual(action, 'skip')

    # —— 仓库侧各类查询失败：一律放行走 update ——
    def test_npm_lookup_failure_fails_open(self):
        (action, why), _, _ = self.decide(npm=socket.timeout('timed out'))
        self.assertEqual(action, 'update')
        self.assertIn('放行', why)

    def test_commit_message_without_version_fails_open(self):
        (action, why), _, _ = self.decide(gh_commits='chore: 改样式', anon_commits='chore: 改样式')
        self.assertEqual(action, 'update')
        self.assertIn('无版本号', why)

    def test_commits_401_falls_back_to_anonymous_request(self):
        (action, _), net, mod = self.decide(gh_commits=http_error(401))
        self.assertEqual(action, 'skip')
        # 先带鉴权问一次（gh 记的是路径），401 后再匿名问一次（http 记的是完整地址）
        self.assertEqual([c[2] for c in net.reads()[1:3]], [commits_path(mod), mod.GH_API + commits_path(mod)])

    def test_commits_401_and_anonymous_403_fails_open(self):
        (action, why), _, _ = self.decide(gh_commits=http_error(401), anon_commits=http_error(403))
        self.assertEqual(action, 'update')
        self.assertIn('放行', why)

    def test_commits_500_fails_open(self):
        (action, _), _, _ = self.decide(gh_commits=http_error(500))
        self.assertEqual(action, 'update')

    def test_repo_file_lookup_failure_fails_open(self):
        (action, why), _, _ = self.decide(repo_md=http_error(404))
        self.assertEqual(action, 'update')
        self.assertIn('发布日期检查失败', why)

    # —— 线上探测：只要没能确认「线上已部署到这一版」，就派发部署 ——
    def test_site_404_triggers_deploy(self):
        (action, why), _, _ = self.decide(site_md=http_error(404))
        self.assertEqual(action, 'deploy')
        self.assertIn('HTTP 404', why)

    def test_site_5xx_triggers_deploy(self):
        for code in (500, 502, 503):
            with self.subTest(code=code):
                (action, why), _, _ = self.decide(site_md=http_error(code))
                self.assertEqual(action, 'deploy')
                self.assertIn('HTTP {}'.format(code), why)

    def test_site_network_error_triggers_deploy(self):
        for err in (socket.timeout('timed out'), urllib.error.URLError('dns'), OSError('conn reset')):
            with self.subTest(error=err):
                (action, why), _, _ = self.decide(site_md=err)
                self.assertEqual(action, 'deploy')
                self.assertIn('线上探测失败', why)

    def test_site_content_differs_triggers_deploy(self):
        (action, why), _, _ = self.decide(site_md=OTHER_MD)
        self.assertEqual(action, 'deploy')
        self.assertIn('与仓库不一致', why)

    def test_new_version_takes_precedence_over_site_probe(self):
        (action, _), net, _ = self.decide(npm='2.1.332', site_md=http_error(404))
        self.assertEqual(action, 'update')
        self.assertFalse(any(c[2].startswith(net.mod.SITE) for c in net.reads()))


class HandlerTests(unittest.TestCase):
    def run_handler(self, action, why='原因', env=None, gate=None, **net_kwargs):
        mod, net = wired(dict({'GH_PAT': 'pat'}, **(env or {})), **net_kwargs)
        mod.gate_decide = gate if gate is not None else (lambda: (action, why))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = mod.main_handler({}, None)
        return result, net, mod, out.getvalue()

    def test_skip_dispatches_nothing(self):
        result, net, _, output = self.run_handler('skip', '原因')
        self.assertEqual(result, {'status': 0, 'msg': '原因'})
        self.assertEqual(net.writes(), [])
        self.assertEqual(output, '原因\n')

    def test_update_targets_update_workflow(self):
        result, net, mod, _ = self.run_handler('update')
        self.assertEqual(result, {'status': 204, 'msg': 'triggered update.yml'})
        self.assertEqual(net.writes(), [
            ('gh', 'PUT', '/repos/{}/actions/workflows/update.yml/enable'.format(mod.REPO), None),
            ('gh', 'POST', '/repos/{}/actions/workflows/update.yml/dispatches'.format(mod.REPO), {'ref': 'main'}),
        ])

    def test_deploy_targets_only_the_deploy_workflow(self):
        result, net, mod, _ = self.run_handler('deploy')
        self.assertEqual(result, {'status': 204, 'msg': 'triggered deploy.yml'})
        self.assertEqual(net.writes(), [
            ('gh', 'PUT', '/repos/{}/actions/workflows/deploy.yml/enable'.format(mod.REPO), None),
            ('gh', 'POST', '/repos/{}/actions/workflows/deploy.yml/dispatches'.format(mod.REPO), {'ref': 'main'}),
        ])

    def test_gate_off_dispatches_update_without_probing(self):
        probed = []
        result, _, _, _ = self.run_handler(None, env={'GATE': '0'}, gate=lambda: probed.append(1))
        self.assertEqual(result['msg'], 'triggered update.yml')
        self.assertEqual(probed, [])

    def test_enable_409_already_enabled_is_silent(self):
        result, _, _, output = self.run_handler('update', enable=http_error(409))
        self.assertEqual(result['status'], 204)
        self.assertNotIn('警告', output)

    def test_enable_http_errors_warn_but_do_not_block_dispatch(self):
        for code in (403, 500, 503):
            with self.subTest(code=code):
                result, _, _, output = self.run_handler('deploy', enable=http_error(code))
                self.assertEqual(result['status'], 204)
                self.assertIn('enable 警告(不阻断): HTTP {}'.format(code), output)

    def test_enable_network_error_warns_but_does_not_block_dispatch(self):
        result, _, _, output = self.run_handler('update', enable=OSError('boom'))
        self.assertEqual(result['status'], 204)
        self.assertIn('enable 警告(不阻断): boom', output)

    def test_dispatch_failure_raises_so_the_invocation_is_marked_failed(self):
        for code in (401, 403, 404, 422):
            with self.subTest(code=code):
                with self.assertRaisesRegex(RuntimeError, 'dispatch deploy.yml 失败: HTTP {}'.format(code)):
                    self.run_handler('deploy', dispatch=http_error(code))

    def test_missing_pat_raises_before_any_request(self):
        mod, net = wired()  # 不给 GH_PAT
        with self.assertRaises(RuntimeError):
            mod.main_handler({}, None)
        self.assertEqual(net.calls, [])


class ConfigTests(unittest.TestCase):
    def test_defaults(self):
        mod = load()
        self.assertEqual((mod.REPO, mod.BRANCH, mod.GATE), ('xianshulaoshi/claude-code-changelog-cn', 'main', True))
        self.assertEqual((mod.WORKFLOW, mod.DEPLOY_WORKFLOW), ('update.yml', 'deploy.yml'))
        self.assertEqual(mod.RAW, 'https://raw.githubusercontent.com/{}/main'.format(mod.REPO))
        self.assertEqual(mod.SITE, DEFAULT_SITE)

    def test_env_overrides(self):
        mod = load({'REPO': 'a/b', 'BRANCH': 'dev', 'SITE': 'https://example.com/', 'GATE': '0',
                    'WORKFLOW': 'u.yml', 'DEPLOY_WORKFLOW': 'd.yml'})
        self.assertEqual(mod.RAW, 'https://raw.githubusercontent.com/a/b/dev')  # 仓库文件跟着 REPO / BRANCH 走
        self.assertEqual(mod.SITE, 'https://example.com')  # 末尾斜杠去掉，拼接路径时才不会出现两个
        self.assertEqual((mod.WORKFLOW, mod.DEPLOY_WORKFLOW, mod.GATE), ('u.yml', 'd.yml', False))

    def test_empty_or_blank_site_env_falls_back_to_default(self):  # 控制台里删变量可能留下空值
        for value in ('', '   ', '\t'):
            with self.subTest(value=repr(value)):
                self.assertEqual(load({'SITE': value}).SITE, DEFAULT_SITE)

    def test_version_comparison_is_numeric(self):
        ver_key = load().ver_key
        self.assertLess(ver_key('2.1.9'), ver_key('2.1.10'))
        self.assertLess(ver_key('2.1.331'), ver_key('2.1.1000'))
        self.assertLess(ver_key('2.1.331'), ver_key('2.2.0'))


class WireTests(unittest.TestCase):
    """不替换 http() / gh()，只打桩最底层的 urlopen。"""

    def setUp(self):
        self.mod = load({'GH_PAT': 'pat'})
        patcher = mock.patch('urllib.request.urlopen')
        self.urlopen = patcher.start()
        self.addCleanup(patcher.stop)
        self.requests = []

    @staticmethod
    def response(status=200, body=b''):
        context = mock.MagicMock()
        landed = context.__enter__.return_value
        landed.status, landed.read.return_value = status, body
        return context

    @staticmethod
    def headers(request):
        return {k.lower(): v for k, v in request.headers.items()}

    def route(self, npm='2.1.331', site_error=None):
        """让 urlopen 按 URL 应答，并记录收到的每个请求。"""
        mod = self.mod

        def fake_urlopen(request, timeout=None):
            url = request.full_url
            self.requests.append(request)
            if url == mod.NPM_LATEST:
                return self.response(200, json.dumps({'version': npm}).encode('utf-8'))
            if url == mod.GH_API + commits_path(mod):
                body = json.dumps([{'commit': {'message': 'docs: 自动更新至 v2.1.331（x）'}}]).encode('utf-8')
                return self.response(200, body)
            if url == '{}/docs/versions/2.1.331.md'.format(mod.RAW):
                return self.response(200, GOOD_MD)
            if url == '{}/versions/2.1.331.md'.format(mod.SITE):
                if site_error is not None:
                    raise site_error
                return self.response(200, GOOD_MD)
            if url.endswith('/enable') or url.endswith('/dispatches'):
                return self.response(204)
            raise AssertionError('意外的请求：' + url)

        self.urlopen.side_effect = fake_urlopen

    def writes(self):
        return [r for r in self.requests if r.get_method() in ('PUT', 'POST')]

    def test_http_sets_its_own_user_agent_and_timeout(self):
        self.urlopen.return_value = self.response(200, b'ok')
        self.assertEqual(self.mod.http('GET', 'https://x.test/a'), (200, b'ok'))
        request = self.urlopen.call_args[0][0]
        self.assertIsInstance(request, urllib.request.Request)
        self.assertEqual((request.get_method(), request.full_url), ('GET', 'https://x.test/a'))
        self.assertEqual(self.headers(request)['user-agent'], self.mod.UA)
        self.assertEqual(self.urlopen.call_args[1], {'timeout': 10})

    def test_gh_get_sends_bearer_token_and_api_version_without_body(self):
        self.urlopen.return_value = self.response(200, b'[]')
        self.mod.gh('GET', '/rate_limit')
        request = self.urlopen.call_args[0][0]
        self.assertEqual(request.full_url, self.mod.GH_API + '/rate_limit')
        headers = self.headers(request)
        self.assertEqual(headers['authorization'], 'Bearer pat')
        self.assertEqual(headers['accept'], 'application/vnd.github+json')
        self.assertEqual(headers['x-github-api-version'], '2022-11-28')
        self.assertIsNone(request.data)
        self.assertNotIn('content-type', headers)

    def test_gh_post_encodes_a_json_body(self):
        self.urlopen.return_value = self.response(204)
        self.assertEqual(self.mod.gh('POST', '/dispatches', {'ref': 'main'}), (204, b''))
        request = self.urlopen.call_args[0][0]
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.data, b'{"ref": "main"}')
        self.assertEqual(self.headers(request)['content-type'], 'application/json')

    def test_non_2xx_surfaces_as_httperror(self):  # 门禁靠这个异常类型区分「线上没有」和「探测失败」
        self.urlopen.side_effect = http_error(404)
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.mod.gh('GET', '/x')
        self.assertEqual(raised.exception.code, 404)

    # —— 整条链路：定时触发入口 → 门禁 → enable → dispatch，只看真实发出的请求 ——
    def test_full_stack_in_sync_reads_four_times_and_writes_nothing(self):
        self.route()
        with quiet():
            result = self.mod.main_handler({}, None)
        self.assertEqual(result['status'], 0)
        self.assertIn('跳过本次', result['msg'])
        self.assertEqual([r.get_method() for r in self.requests], ['GET'] * 4)
        self.assertEqual(self.requests[-1].full_url, self.mod.SITE + '/versions/2.1.331.md')

    def test_full_stack_site_404_dispatches_the_deploy_workflow(self):
        self.route(site_error=http_error(404))
        with quiet():
            result = self.mod.main_handler({}, None)
        self.assertEqual(result, {'status': 204, 'msg': 'triggered deploy.yml'})
        base = '{}/repos/{}/actions/workflows/deploy.yml'.format(self.mod.GH_API, self.mod.REPO)
        self.assertEqual([(r.get_method(), r.full_url) for r in self.writes()], [
            ('PUT', base + '/enable'),
            ('POST', base + '/dispatches'),
        ])
        self.assertEqual(self.writes()[-1].data, b'{"ref": "main"}')

    def test_full_stack_new_version_dispatches_the_update_workflow(self):
        self.route(npm='2.1.332', site_error=http_error(404))  # 即使线上探测会失败也不该被问到
        with quiet():
            result = self.mod.main_handler({}, None)
        self.assertEqual(result, {'status': 204, 'msg': 'triggered update.yml'})
        base = '{}/repos/{}/actions/workflows/update.yml'.format(self.mod.GH_API, self.mod.REPO)
        self.assertEqual([r.full_url for r in self.writes()], [base + '/enable', base + '/dispatches'])
        self.assertFalse(any(r.full_url.startswith(self.mod.SITE) for r in self.requests))


if __name__ == '__main__':
    unittest.main()
