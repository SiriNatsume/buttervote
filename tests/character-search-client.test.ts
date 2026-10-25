import assert from "node:assert/strict";
import test from "node:test";
import { createCharacterSearchClient } from "../lib/character-search/client-search";

const complete = { items: [], hasMore: false, errors: [] };
const signal = () => new AbortController().signal;

test("repeated complete searches reuse results while source, keyword and page remain independent", async () => {
  const requests: string[] = [];
  const search = createCharacterSearchClient({ fetcher: async (url) => {
    requests.push(String(url));
    return Response.json(complete);
  } });
  await search("佐仓濑津美", "all", 1, signal());
  await search("  佐仓濑津美  ", "all", 1, signal());
  assert.equal(requests.length, 1);
  await search("佐仓濑津美", "bangumi", 1, signal());
  await search("佐仓濑津美", "all", 2, signal());
  await search("Murasame", "all", 1, signal());
  assert.equal(requests.length, 4);
});

test("cached results expire after two minutes without extending stale entries on reads", async () => {
  let now = 1000;
  let requests = 0;
  const search = createCharacterSearchClient({ now: () => now, fetcher: async () => {
    requests++;
    return Response.json(complete);
  } });
  await search("Setsumi", "all", 1, signal());
  now = 120999;
  await search("Setsumi", "all", 1, signal());
  assert.equal(requests, 1);
  now = 121000;
  await search("Setsumi", "all", 1, signal());
  assert.equal(requests, 2);
});

test("the memory cache evicts old searches while keeping recent results reusable", async () => {
  let requests = 0;
  const search = createCharacterSearchClient({ fetcher: async () => {
    requests++;
    return Response.json(complete);
  } });
  for (let index = 0; index < 20; index++) await search(`character-${index}`, "all", 1, signal());
  await search("character-19", "all", 1, signal());
  assert.equal(requests, 20);
  await search("character-0", "all", 1, signal());
  assert.equal(requests, 21);
});

test("partial results, authentication failures and malformed responses are not cached", async () => {
  for (const failure of [
    () => Response.json({ ...complete, errors: [{ source: "bangumi", message: "暂不可用" }] }),
    () => Response.json({ error: "请先登录。" }, { status: 401 }),
    () => Response.json({ unexpected: true }),
  ]) {
    let requests = 0;
    const search = createCharacterSearchClient({ fetcher: async () => ++requests === 1 ? failure() : Response.json(complete) });
    await search("Setsumi", "all", 1, signal()).catch(() => undefined);
    assert.deepEqual(await search("Setsumi", "all", 1, signal()), complete);
    assert.equal(requests, 2);
  }
});

test("a cancelled response cannot be shown or cached and a later search can retry", async () => {
  const controller = new AbortController();
  let requests = 0;
  const search = createCharacterSearchClient({ fetcher: async (_url, init) => {
    requests++;
    if (requests === 1) {
      assert.equal(init?.signal, controller.signal);
      controller.abort();
    }
    return Response.json(complete);
  } });
  await assert.rejects(search("Setsumi", "all", 1, controller.signal), { name: "AbortError" });
  await search("Setsumi", "all", 1, signal());
  assert.equal(requests, 2);
});
