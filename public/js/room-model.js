export async function uploadPhotoBatches(pending, upload, completed) {
  while (pending.length) {
    const batch = pending.slice(0, 10);
    const data = new FormData();
    batch.forEach((file) => data.append("images", file));
    const result = await upload(data);
    pending.splice(0, batch.length);
    completed(result);
  }
}

export { mountArchitecturalModel as mountRoomModel } from "./architectural-model.js";
