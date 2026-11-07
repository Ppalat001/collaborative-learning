import "../helpers/testDb";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { addDiscussionMessage, getOrCreateAttempt } from "@/lib/services/sessions";
import { buildGroupExport, EXPORT_BUILDERS, type ExportType } from "@/lib/utils/export";
import { createLegacyGroup, createV2Group } from "../helpers/fixtures";

/**
 * The eight original CSV exports must keep their exact columns. The fixture was
 * recorded from the unchanged original export code; regenerate it only on purpose
 * with UPDATE_FIXTURES=1 (and document why in the data dictionary).
 */
const FIXTURE = path.join(process.cwd(), "tests", "fixtures", "legacy-export-columns.json");

async function columnsFor(sessionId: string) {
  const result: Record<string, string[]> = {};
  for (const type of Object.keys(EXPORT_BUILDERS) as ExportType[]) {
    result[type] = (await buildGroupExport(type, sessionId)).columns;
  }
  return result;
}

describe("Original research exports", () => {
  test("the eight legacy exports keep their exact columns", async () => {
    const legacy = await createLegacyGroup(2);
    await getOrCreateAttempt(legacy.session.id, 1);
    await addDiscussionMessage(legacy.session.id, 1, legacy.members[0].participant.id, "hello");
    const columns = await columnsFor(legacy.session.id);
    assert.equal(Object.keys(columns).length, 8);

    if (process.env.UPDATE_FIXTURES === "1") {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(columns, null, 2)}\n`);
    }
    const expected = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    assert.deepEqual(columns, expected);
  });

  test("V2 groups produce the same legacy export columns (V2 data has its own exports)", async () => {
    const group = await createV2Group({ condition: "dual_adaptive" });
    await getOrCreateAttempt(group.session.id, 1);
    const expected = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    assert.deepEqual(await columnsFor(group.session.id), expected);
  });
});
