import test from "node:test";
import assert from "node:assert/strict";
import { uploadPhotoBatches } from "../public/js/room-model.js";

test("photo uploads are sequential and preserve completed batches after failure", async () => {
  const pending = Array.from(
    { length: 25 },
    (_, i) => new Blob([String(i)], { type: "image/jpeg" }),
  );
  const sizes = [];
  let active = 0;
  const completed = [];
  await assert.rejects(
    uploadPhotoBatches(
      pending,
      async (data) => {
        assert.equal(active++, 0);
        sizes.push(data.getAll("images").length);
        await Promise.resolve();
        active--;
        if (sizes.length === 2) throw new Error("upload failed");
        return { images: ["saved"] };
      },
      (result) => completed.push(result.images),
    ),
    /upload failed/,
  );
  assert.deepEqual(sizes, [10, 10]);
  assert.equal(pending.length, 15);
  assert.deepEqual(completed, [["saved"]]);
});
