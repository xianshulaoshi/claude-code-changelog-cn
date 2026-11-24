#!/usr/bin/env python3
"""校验 .github/workflows/deploy.yml 里「部署失败重试」的编排：对每次尝试所有可能的结果组合，求值文件里
真实的 if / environment.url 表达式，检查编排的不变量。全程不发网络请求。

依赖：标准库 unittest，外加 PyYAML（只有本文件需要：pip3 install pyyaml）。

运行（仓库根目录）：

    python3 -B -m unittest discover -s scf-trigger -p 'test_*.py'

这里只模拟这套编排用到的语义，不是通用的 GitHub Actions 表达式求值器：

- steps.<id>.outcome：success / failure / cancelled；未运行的步骤为 skipped
- steps.<id>.outputs.<name>：未运行的步骤输出为空串
- 运算符 == != && ||
- 带 continue-on-error 的步骤失败后 job 继续；其余步骤失败即 job 失败
"""
import itertools
import os
import re
import sys
import unittest

sys.dont_write_bytecode = True  # 不在仓库里留 __pycache__/

try:
    import yaml
except ImportError:
    # 明确报错而不是静默跳过：跳过会让人误以为部署编排已经被验证过
    raise ImportError('test_deploy_workflow.py 需要 PyYAML：pip3 install pyyaml')

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOY_YML = os.path.join(REPO_ROOT, '.github', 'workflows', 'deploy.yml')
DEPLOY_ACTION = 'actions/deploy-pages@v4'
VERDICT_STEP = '部署结果'
PAGE_URL = 'https://pages.test/attempt-{}'


def kind(step):
    """步骤在这套编排里的角色：attempt（一次部署尝试）/ wait（重试前的等待）/ verdict（判 job 失败）/ other。"""
    if step.get('uses') == DEPLOY_ACTION:
        return 'attempt'
    if step.get('run', '').startswith('sleep'):
        return 'wait'
    if step.get('name') == VERDICT_STEP:
        return 'verdict'
    return 'other'


def to_python(expr, attempts, outcomes, urls):
    """把 if / environment.url 里的表达式机械翻译成 Python 再求值；遇到模拟器不认识的片段直接报错。

    GitHub 允许 if 条件省略 ${{ }}，YAML 也可能把它直接解析成布尔值——三种写法都按 GitHub 的语义处理。
    """
    if not isinstance(expr, str):
        return bool(expr)
    body = expr.strip()
    if body.startswith('${{') and body.endswith('}}'):
        body = body[3:-2]
    body = body.replace('&&', ' and ').replace('||', ' or ')
    for n in attempts:
        body = body.replace('steps.deploy_{}.outcome'.format(n), repr(outcomes[n]))
        body = body.replace('steps.deploy_{}.outputs.page_url'.format(n), repr(urls[n]))
    if re.search(r'\bsteps\b|\boutcome\b|\boutputs\b', body):
        raise AssertionError('表达式里有本模拟器不认识的片段：' + expr)
    return eval(body, {'__builtins__': {}})


def simulate(steps, url_expr, attempts, forced):
    """按一种结果组合模拟整个 deploy job。forced：{尝试序号: 该尝试真正运行时的结果}。

    先假定「尝试 N 只有在它之前的尝试都没成功时才会运行」，未运行的 outcome 记为 skipped；然后严格
    按文件里每一步自己的 if 决定它是否执行。两个口径互相印证：文件的 if 写错时二者会对不上。
    """
    outcomes, urls = {}, {}
    for n in attempts:
        runs = all(outcomes[earlier] != 'success' for earlier in attempts if earlier < n)
        outcomes[n] = forced[n] if runs else 'skipped'
        urls[n] = PAGE_URL.format(n) if outcomes[n] == 'success' else ''
    ran = [s for s in steps if 'if' not in s or to_python(s['if'], attempts, outcomes, urls)]
    ran_attempts = [int(s['id'].split('_')[1]) for s in ran if kind(s) == 'attempt']
    waits = sum(1 for s in ran if kind(s) == 'wait')
    job_failed = any(kind(s) == 'verdict' for s in ran)
    return ran_attempts, waits, job_failed, to_python(url_expr, attempts, outcomes, urls)


class DeployWorkflowTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DEPLOY_YML, encoding='utf-8') as handle:
            job = yaml.safe_load(handle)['jobs']['deploy']
        cls.steps, cls.url_expr = job['steps'], job['environment']['url']
        cls.attempts = tuple(int(s['id'].split('_')[1]) for s in cls.steps if kind(s) == 'attempt')

    def check(self, forced):
        """对一种结果组合检查全部不变量，返回 (运行的尝试, 等待次数, job 是否失败, 环境 URL)。"""
        ran_attempts, waits, job_failed, url = simulate(self.steps, self.url_expr, self.attempts, forced)
        winners = [n for n in ran_attempts if forced[n] == 'success']
        first = winners[0] if winners else None
        self.assertEqual(ran_attempts, list(self.attempts[:first or len(self.attempts)]),
                         '应依次重试到首次成功为止，成功之后不再部署')
        self.assertEqual(waits, len(ran_attempts) - 1, '每次重试之前都应等待一次')
        self.assertEqual(job_failed, first is None, '只有全部失败才判 job 失败')
        self.assertEqual(url, PAGE_URL.format(first) if first else '', '环境 URL 应取自首次成功的那次尝试')
        return ran_attempts, waits, job_failed, url


class ShapeTests(DeployWorkflowTestCase):
    """编排的结构前提——下面的不变量测试只有在这些前提成立时才有意义。"""

    def test_attempts_are_numbered_from_one_and_never_fail_the_job_themselves(self):
        self.assertEqual(self.attempts, tuple(range(1, len(self.attempts) + 1)))
        for step in self.steps:
            if kind(step) == 'attempt':
                self.assertIs(step.get('continue-on-error'), True, '尝试失败必须放行，否则后面的尝试没机会运行')

    def test_artifact_is_uploaded_before_the_first_attempt(self):
        uploads = [i for i, s in enumerate(self.steps) if 'upload-pages-artifact' in s.get('uses', '')]
        first_attempt = next(i for i, s in enumerate(self.steps) if kind(s) == 'attempt')
        self.assertEqual(len(uploads), 1)
        self.assertLess(uploads[0], first_attempt)

    def test_layout_is_attempt_wait_alternating_then_verdict(self):
        roles = [kind(s) for s in self.steps]
        roles = [r for r in roles if r != 'other']
        self.assertEqual(roles, ['attempt', 'wait'] * (len(self.attempts) - 1) + ['attempt', 'verdict'])

    def test_verdict_step_is_not_soft_fail(self):
        verdicts = [s for s in self.steps if kind(s) == 'verdict']
        self.assertEqual(len(verdicts), 1)
        self.assertNotIn('continue-on-error', verdicts[0])


class RetryInvariantTests(DeployWorkflowTestCase):
    def test_invariants_hold_for_every_combination_of_outcomes(self):
        outcomes = ('success', 'failure', 'cancelled', 'skipped')
        for combo in itertools.product(outcomes, repeat=len(self.attempts)):
            forced = dict(zip(self.attempts, combo))
            with self.subTest(forced=forced):
                self.check(forced)

    def test_the_scenarios_that_matter_in_practice(self):
        last = len(self.attempts)
        scenarios = [
            # (场景, 第几次尝试才成功——None 表示全部失败, 期望的等待次数, 期望 job 失败)
            ('首次即成功', 1, 0, False),
            ('第二次才成功（2026-11-24 线上实发）', 2, 1, False),
            ('最后一次才成功', last, last - 1, False),
            ('全部失败', None, last - 1, True),
        ]
        for label, winner, want_waits, want_failed in scenarios:
            forced = {n: 'failure' for n in self.attempts}
            if winner is not None:
                forced[winner] = 'success'
            with self.subTest(scenario=label):
                _, waits, failed, url = self.check(forced)
                self.assertEqual((waits, failed), (want_waits, want_failed))
                self.assertEqual(url, PAGE_URL.format(winner) if winner else '')


if __name__ == '__main__':
    unittest.main()
