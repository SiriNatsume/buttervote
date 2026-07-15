import assert from "node:assert/strict";
import test from "node:test";
import {
  HALL_OF_FAME_IMAGE_TYPES,
  HALL_OF_FAME_MAX_FILE_SIZE,
  HALL_OF_FAME_THUMBNAIL_MAX_FILE_SIZE,
  HALL_OF_FAME_THUMBNAIL_TYPES,
} from "../lib/hall-of-fame";
import {
  hallOfFameEntryIdSchema,
  hallOfFameEntryInputSchema,
  hallOfFameOrderSchema,
} from "../lib/validation/hall-of-fame";

const entryId = "11111111-1111-4111-8111-111111111111";
const contestId = "22222222-2222-4222-8222-222222222222";

test("hall of fame input trims text and normalizes empty optional ids", () => {
  const parsed = hallOfFameEntryInputSchema.parse({
    entryId: "",
    contestId: ` ${contestId} `,
    eventTitle: "  夏季赛  ",
    winnerName: "  角色 Alpha  ",
    description: "  冠军海报  ",
  });

  assert.deepEqual(parsed, {
    entryId: null,
    contestId,
    eventTitle: "夏季赛",
    winnerName: "角色 Alpha",
    description: "冠军海报",
  });
});

test("hall of fame ids reject malformed values", () => {
  assert.equal(hallOfFameEntryIdSchema.safeParse("not-a-uuid").success, false);
  assert.equal(
    hallOfFameEntryInputSchema.safeParse({
      entryId: "not-a-uuid",
      contestId: "",
      eventTitle: "赛事",
      winnerName: "胜者",
      description: "",
    }).success,
    false,
  );
});

test("hall of fame ordering rejects duplicate ids", () => {
  assert.equal(hallOfFameOrderSchema.safeParse([entryId, entryId]).success, false);
  assert.equal(
    hallOfFameOrderSchema.safeParse([entryId, contestId]).success,
    true,
  );
});

test("hall of fame text limits are enforced", () => {
  const parsed = hallOfFameEntryInputSchema.safeParse({
    entryId: "",
    contestId: "",
    eventTitle: "x".repeat(121),
    winnerName: "胜者",
    description: "",
  });

  assert.equal(parsed.success, false);
});

test("hall of fame keeps originals while constraining thumbnails", () => {
  assert.equal(HALL_OF_FAME_IMAGE_TYPES.includes("image/png"), true);
  assert.equal(HALL_OF_FAME_THUMBNAIL_TYPES.includes("image/png" as never), false);
  assert.equal(HALL_OF_FAME_MAX_FILE_SIZE, 20 * 1024 * 1024);
  assert.equal(HALL_OF_FAME_THUMBNAIL_MAX_FILE_SIZE, 320 * 1024);
});
