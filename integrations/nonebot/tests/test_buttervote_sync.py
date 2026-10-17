from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from nonebot_plugin_buttervote.config import Config
from nonebot_plugin_buttervote.worker import GroupSyncWorker, IncompleteRoster, normalize_roster


ROOT = Path(__file__).resolve().parents[1]
GROUP = "54321"
JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
LEASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
MEMBER = {"user_id": 12345, "group_id": 54321, "nickname": "测试成员", "card": "名片"}
INFO = {"group_id": 54321, "member_count": 1}


def config(**updates):
    return Config(**{
        "buttervote_url": "https://vote.example",
        "bot_api_secret": "test-secret",
        "buttervote_sync_allowed_groups": [GROUP],
        **updates,
    })


def bot(**updates):
    return SimpleNamespace(**{
        "self_id": "67890",
        "call_api": AsyncMock(side_effect=[dict(INFO), [dict(MEMBER)], dict(INFO)]),
        **updates,
    })


class Website:
    """A task queue/result endpoint with the existing website wire format."""

    def __init__(self, job=None):
        self.job = job or {"id": JOB_ID, "leaseId": LEASE_ID, "qqGroupId": GROUP}
        self.requests = []
        self.roster = [{"qq_user_id": "99999", "nickname": "上次名单", "card": ""}]
        self.results = []
        self.publish_statuses = []

    def __call__(self, request):
        assert request.headers["authorization"] == "Bearer test-secret"
        body = json.loads(request.content)
        self.requests.append((request.url.path, body))
        if request.url.path == "/api/bot/group-sync/claim":
            job, self.job = self.job, None
            return httpx.Response(200, json={"job": job})
        assert request.url.path == f"/api/bot/group-sync/{JOB_ID}"
        assert body["leaseId"] == LEASE_ID
        status = self.publish_statuses.pop(0) if self.publish_statuses else 200
        if status != 200:
            return httpx.Response(status, json={"error": "test"})
        self.results.append(body)
        if "members" in body:
            self.roster = body["members"]
        return httpx.Response(200, json={"ok": True})


class ConfigTests(unittest.TestCase):
    def test_allowlist_formats_and_all(self):
        for groups in ([54321, 98765], ["54321", "98765"], "54321, 98765", "[54321,98765]"):
            value = config(buttervote_sync_allowed_groups=groups)
            value.validate_sync()
            self.assertTrue(value.allows_group(GROUP))
            self.assertFalse(value.allows_group("11111"))
        for groups in ("all", " ALL ", "All"):
            value = config(buttervote_sync_allowed_groups=groups)
            value.validate_sync()
            self.assertTrue(value.allows_group("11111"))

    def test_missing_or_invalid_config_does_not_enable_sync(self):
        cases = [
            {"buttervote_url": ""}, {"bot_api_secret": ""},
            {"buttervote_sync_allowed_groups": ""},
            {"buttervote_sync_allowed_groups": "any"},
            {"buttervote_sync_allowed_groups": "54321,all"},
            {"buttervote_sync_allowed_groups": "[bad-json"},
            {"buttervote_sync_allowed_groups": ["opaque-openid"]},
            {"buttervote_sync_bot_id": "opaque-openid"},
        ]
        for values in cases:
            with self.subTest(values=values), self.assertRaises(ValueError):
                config(**values).validate_sync()

    def test_url_restrictions_and_secret_representation(self):
        for url in (
            "http://vote.example", "https://user:password@vote.example", "ftp://vote.example",
            "https://vote.example/path", "https://vote.example?token=x", "https://vote.example#x",
            "https://vote.example:99999", "https://vote.example\\@evil.example", "https://vote.example /",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                config(buttervote_url=url).validate_sync()
        for url in ("https://vote.example/", "http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"):
            config(buttervote_url=url).validate_sync()
        self.assertNotIn("test-secret", repr(config()))
        self.assertNotIn("test-secret", str(config()))


class RosterTests(unittest.TestCase):
    def test_complete_snapshot_and_missing_card(self):
        members = normalize_roster([{**MEMBER, "card": None}], INFO, INFO, GROUP)
        self.assertEqual(members, [{"qq_user_id": "12345", "nickname": "测试成员", "card": ""}])

    def test_rejects_partial_duplicate_changing_and_wrong_group_snapshots(self):
        cases = [
            ([], INFO, INFO), ([MEMBER], INFO, {**INFO, "member_count": 2}),
            ([MEMBER, MEMBER], {**INFO, "member_count": 2}, {**INFO, "member_count": 2}),
            ([{**MEMBER, "group_id": 99999}], INFO, INFO),
            ([MEMBER], {**INFO, "group_id": 99999}, INFO),
            ([MEMBER], INFO, {**INFO, "group_id": 99999}),
            ([MEMBER], {**INFO, "member_count": True}, INFO),
            ([MEMBER], INFO, {**INFO, "member_count": True}),
            ([MEMBER], None, INFO), ([None], INFO, INFO), (None, INFO, INFO),
            ([{**MEMBER, "nickname": None}], INFO, INFO),
            ([{**MEMBER, "card": {}}], INFO, INFO),
        ]
        for members, before, after in cases:
            with self.subTest(members=members, before=before, after=after), self.assertRaises(IncompleteRoster):
                normalize_roster(members, before, after, GROUP)
        for qq in ("opaque-openid", 12345.0, True, None, "012345", "1234"):
            with self.subTest(qq=qq), self.assertRaises(IncompleteRoster):
                normalize_roster([{**MEMBER, "user_id": qq}], INFO, INFO, GROUP)

    def test_long_emoji_names_fit_the_website_utf16_limit(self):
        roster = normalize_roster([{**MEMBER, "nickname": "😀" * 120, "card": "名" * 130}], INFO, INFO, GROUP)
        self.assertEqual(roster[0]["nickname"], "😀" * 60)
        self.assertEqual(roster[0]["card"], "名" * 120)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def make_worker(self, *, settings=None, bots=None, website=None):
        site = website or Website()
        client = httpx.AsyncClient(transport=httpx.MockTransport(site))
        self.addAsyncCleanup(client.aclose)
        connected = [bot()] if bots is None else bots
        worker = GroupSyncWorker(settings or config(), lambda: connected, client=client)
        self.addAsyncCleanup(worker.stop)
        return worker, connected, site

    async def test_full_task_round_trip_uses_existing_bot_and_lease(self):
        worker, bots, site = await self.make_worker()
        self.assertTrue(await worker.run_once())
        self.assertEqual([call.args[0] for call in bots[0].call_api.await_args_list],
                         ["get_group_info", "get_group_member_list", "get_group_info"])
        for call in bots[0].call_api.await_args_list:
            self.assertEqual(call.kwargs, {"group_id": 54321, "no_cache": True})
        self.assertEqual(site.roster, [{"qq_user_id": "12345", "nickname": "测试成员", "card": "名片"}])
        self.assertEqual([path for path, _ in site.requests],
                         ["/api/bot/group-sync/claim", f"/api/bot/group-sync/{JOB_ID}"])
        self.assertFalse(await worker.run_once())

    async def test_all_allows_a_group_not_listed_in_config(self):
        worker, bots, site = await self.make_worker(settings=config(buttervote_sync_allowed_groups="all"))
        self.assertTrue(await worker.run_once())
        self.assertIn("members", site.results[0])
        self.assertEqual(bots[0].call_api.await_count, 3)

    async def test_disallowed_group_never_queries_bot_and_preserves_previous_roster(self):
        worker, bots, site = await self.make_worker(settings=config(buttervote_sync_allowed_groups="11111"))
        self.assertTrue(await worker.run_once())
        bots[0].call_api.assert_not_awaited()
        self.assertEqual(site.results, [{"leaseId": LEASE_ID, "error": "group_not_allowed"}])
        self.assertEqual(site.roster[0]["qq_user_id"], "99999")

    async def test_bad_or_failed_bot_snapshot_preserves_previous_roster(self):
        for sequence, reason in (
            ([INFO, [], INFO], "incomplete_roster"),
            ([INFO, [MEMBER], {**INFO, "member_count": 2}], "incomplete_roster"),
            ([RuntimeError("do not log credentials or roster")], "bot_unavailable"),
            ([asyncio.TimeoutError()], "bot_unavailable"),
        ):
            with self.subTest(reason=reason):
                worker, _, site = await self.make_worker(bots=[bot(call_api=AsyncMock(side_effect=sequence))])
                self.assertTrue(await worker.run_once())
                self.assertEqual(site.results, [{"leaseId": LEASE_ID, "error": reason}])
                self.assertEqual(site.roster[0]["qq_user_id"], "99999")

    async def test_offline_bot_does_not_claim_and_recovers_on_connection(self):
        worker, bots, site = await self.make_worker(bots=[])
        self.assertFalse(await worker.run_once())
        self.assertEqual(site.requests, [])
        bots.append(bot())
        self.assertTrue(await worker.run_once())

    async def test_multiple_bots_require_an_explicit_account(self):
        first, second = bot(), bot(self_id="78901")
        worker, _, site = await self.make_worker(bots=[first, second])
        self.assertFalse(await worker.run_once())
        self.assertEqual(site.requests, [])
        worker.config.buttervote_sync_bot_id = second.self_id
        self.assertTrue(await worker.run_once())
        first.call_api.assert_not_awaited()
        self.assertEqual(second.call_api.await_count, 3)

    async def test_unconnected_selected_bot_does_not_fall_back_to_another_account(self):
        worker, bots, site = await self.make_worker(settings=config(buttervote_sync_bot_id="78901"))
        self.assertFalse(await worker.run_once())
        self.assertEqual(site.requests, [])
        bots[0].call_api.assert_not_awaited()

    async def test_pending_result_retries_without_claiming_or_refetching_even_if_bot_disconnects(self):
        worker, bots, site = await self.make_worker()
        site.publish_statuses = [503, 200]
        with self.assertRaises(httpx.HTTPStatusError):
            await worker.run_once()
        used_bot = bots.pop()
        self.assertTrue(await worker.run_once())
        self.assertEqual(used_bot.call_api.await_count, 3)
        self.assertEqual(sum(path.endswith("/claim") for path, _ in site.requests), 1)
        self.assertEqual(site.requests[1], site.requests[2])
        self.assertIsNone(worker._pending)

    async def test_expired_lease_is_discarded_without_overwriting_roster(self):
        worker, _, site = await self.make_worker()
        site.publish_statuses = [409]
        self.assertFalse(await worker.run_once())
        self.assertIsNone(worker._pending)
        self.assertEqual(site.roster[0]["qq_user_id"], "99999")

    async def test_redirect_is_not_followed_with_secret_or_roster(self):
        requests = []
        def redirect(request):
            requests.append(request)
            return httpx.Response(307, headers={"Location": "https://elsewhere.example"})
        client = httpx.AsyncClient(transport=httpx.MockTransport(redirect), follow_redirects=True)
        self.addAsyncCleanup(client.aclose)
        worker = GroupSyncWorker(config(), lambda: [bot()], client=client)
        with self.assertRaises(httpx.HTTPStatusError):
            await worker.run_once()
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.host, "vote.example")

    async def test_invalid_job_never_queries_bot_or_posts_a_result(self):
        site = Website(job={"id": "invalid", "leaseId": LEASE_ID, "qqGroupId": GROUP})
        worker, bots, _ = await self.make_worker(website=site)
        with self.assertRaises(ValueError):
            await worker.run_once()
        bots[0].call_api.assert_not_awaited()
        self.assertEqual(len(site.requests), 1)

    async def test_concurrent_calls_do_not_read_the_same_job_twice(self):
        worker, bots, site = await self.make_worker()
        self.assertEqual(await asyncio.gather(worker.run_once(), worker.run_once()), [True, False])
        self.assertEqual(bots[0].call_api.await_count, 3)
        self.assertEqual(len(site.results), 1)

    async def test_start_is_idempotent_and_shutdown_cancels_pending_bot_call(self):
        started = asyncio.Event()
        async def blocked(*args, **kwargs):
            started.set()
            await asyncio.Event().wait()
        worker, _, site = await self.make_worker(bots=[bot(call_api=blocked)])
        await worker.start()
        task = worker._task
        await worker.start()
        self.assertIs(task, worker._task)
        await asyncio.wait_for(started.wait(), 2)
        await asyncio.wait_for(worker.stop(), 2)
        self.assertTrue(task.cancelled())
        self.assertEqual(site.results, [])
        self.assertIsNone(worker._task)

    async def test_disabled_or_missing_config_does_not_start_or_block_bot(self):
        for settings in (Config(), config(buttervote_sync_enabled=False)):
            worker = GroupSyncWorker(settings, lambda: [])
            await worker.start()
            self.assertIsNone(worker._task)
            self.assertIsNone(worker._client)
            await worker.stop()

    async def test_owned_http_client_is_closed(self):
        worker = GroupSyncWorker(config(), lambda: [bot()])
        client = httpx.AsyncClient(transport=httpx.MockTransport(Website()))
        with patch("nonebot_plugin_buttervote.worker.httpx.AsyncClient", return_value=client):
            await worker.run_once()
        self.assertFalse(client.is_closed)
        await worker.stop()
        self.assertTrue(client.is_closed)


class LifecycleTests(unittest.TestCase):
    def run_script(self, script):
        result = subprocess.run(
            [sys.executable, "-c", textwrap.dedent(script)], cwd=ROOT,
            text=True, capture_output=True, timeout=20, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_dotenv_all_and_legacy_csv_are_loaded_by_real_nonebot_settings(self):
        for groups in ("all", "54321,98765", "[54321,98765]"):
            with self.subTest(groups=groups), tempfile.TemporaryDirectory() as directory:
                env = Path(directory) / "bot.env"
                env.write_text("BUTTERVOTE_URL=https://vote.example\nBOT_API_SECRET=test-secret\n"
                               f"BUTTERVOTE_SYNC_ALLOWED_GROUPS={groups}\n", encoding="utf-8")
                self.run_script(f"""
                    import nonebot
                    nonebot.init(driver="~none", _env_file={str(env)!r})
                    plugin = nonebot.load_plugin("nonebot_plugin_buttervote")
                    assert plugin is not None
                    config = plugin.module.plugin_config
                    config.validate_sync()
                    assert config.allows_group("54321")
                    assert config.allows_group("11111") == {groups == 'all'!r}
                    assert "test-secret" not in repr(config)
                """)

    def test_submodule_import_before_init_can_later_load_plugin_once(self):
        self.run_script("""
            import nonebot_plugin_buttervote.worker
            import nonebot
            nonebot.init(driver="~none", _env_file=None)
            plugin = nonebot.load_plugin("nonebot_plugin_buttervote")
            assert plugin is not None
            driver = nonebot.get_driver()
            assert len(driver._lifespan._startup_funcs) == 1
            assert len(driver._lifespan._shutdown_funcs) == 1
            assert len(plugin.matcher) == 0
            assert nonebot.get_plugin("nonebot_plugin_buttervote") is plugin
            assert len(driver._lifespan._startup_funcs) == 1
        """)

    def test_real_nonebot_lifecycle_connected_onebot_and_local_http_round_trip(self):
        self.run_script("""
            import asyncio
            import json
            import threading
            from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

            import nonebot
            from nonebot.adapters.onebot.v11 import Adapter, Bot

            published = threading.Event()
            calls = []
            job = {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                   "leaseId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "qqGroupId": "54321"}

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass
                def do_POST(self):
                    assert self.headers["Authorization"] == "Bearer test-secret"
                    body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    calls.append((self.path, body))
                    if self.path.endswith("/claim"):
                        result = {"job": job}
                    else:
                        assert body == {"leaseId": job["leaseId"], "members": [
                            {"qq_user_id": "12345", "nickname": "成员", "card": ""}]}
                        result = {"ok": True}
                    data = json.dumps(result).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    if not self.path.endswith("/claim"):
                        published.set()

            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            nonebot.init(driver="~none", _env_file=None,
                         buttervote_url=f"http://127.0.0.1:{server.server_port}",
                         bot_api_secret="test-secret", buttervote_sync_allowed_groups="all")
            plugin = nonebot.load_plugin("nonebot_plugin_buttervote")
            assert plugin is not None
            driver = nonebot.get_driver()

            class TestAdapter(Adapter):
                async def _call_api(self, bot, api, **data):
                    assert data == {"group_id": 54321, "no_cache": True}
                    if api == "get_group_member_list":
                        return [{"group_id": 54321, "user_id": 12345, "nickname": "成员"}]
                    assert api == "get_group_info"
                    return {"group_id": 54321, "member_count": 1}

            async def main():
                adapter = TestAdapter(driver)
                connected_bot = Bot(adapter, "67890")
                adapter.bot_connect(connected_bot)
                await driver._lifespan.startup()
                try:
                    assert await asyncio.to_thread(published.wait, 5)
                    # Let the worker receive the final HTTP response.
                    for _ in range(100):
                        if plugin.module.worker._pending is None:
                            break
                        await asyncio.sleep(0.01)
                    assert plugin.module.worker._pending is None
                    client = plugin.module.worker._client
                    assert client is not None and not client.is_closed
                    assert len(calls) == 2
                finally:
                    await driver._lifespan.shutdown()
                    adapter.bot_disconnect(connected_bot)
                assert plugin.module.worker._task is None
                assert client.is_closed

            try:
                asyncio.run(main())
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
        """)


if __name__ == "__main__":
    unittest.main()
