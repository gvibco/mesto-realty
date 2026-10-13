# Architectural models

The active property viewer now displays white architectural geometry with an open-roof overview and interior navigation. It replaces the previous photo splat viewer. Geometry is generated automatically from an uploaded floor-plan image, photographs and overall width/depth/ceiling height in metres. Furniture dimensions without measurements remain approximate.

Owners add the plan and dimensions in the property editor. PNG, JPEG and WebP plans are accepted up to 8 MB. Photographs are optional: when present they refine furniture types, but the plan and dimensions alone are enough to queue generation. Successful photo batches are saved before architectural inputs; publishing then exposes the ready model to all visitors. Saving a failed model retries it. Land listings do not show architectural inputs.

The installed worker uses local GPU vision through Ollama and a separately cached image-language model. It downloads only leased input images. Photographs classify furniture types; the plan is grounded in normalized image coordinates. A local raster check centres walls on actual strokes (stroke threshold adapts per image via Otsu, clamped to 80–210, so light grey plans work too), verifies opening gaps and missing thick partitions, requires a closed exterior, and converts observations to owner-supplied metre dimensions. Validated JSON returns to the website. Unreadable topology never becomes a generic rectangular substitute. It no longer starts Gaussian training. The PC and Docker must remain running for new jobs. The local inference service has no published network port and never receives the website Bearer token.

Without `ROOM_MODEL_LOCAL_VISION_URL`, the worker retains server-side cloud analysis. The existing `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` must then identify a provider that accepts image content and JSON output through `/chat/completions`; credentials remain on the website. Cloud analysis returned HTTP429 during deployment, so the installed setup uses local inference.

Restart the installed worker from the repository root:

```powershell
docker compose --project-directory worker -f worker/compose.yaml up -d room-model-vision
docker compose --project-directory worker -f worker/compose.yaml exec room-model-vision ollama pull qwen3-vl:8b-instruct
docker compose --project-directory worker -f worker/compose.yaml up -d --build room-model-worker
```

The default is explicitly `qwen3-vl:8b-instruct`. Replace an existing `ROOM_MODEL_LOCAL_VISION_MODEL=qwen3-vl:4b` override with that tag, or remove the override to use the default. The [official tags](https://ollama.com/library/qwen3-vl/tags) identify `4b` as the same model as `4b-thinking`; that variant consumed the short appearance output budget on hidden reasoning during the live probe despite `think:false`. Pull the instruct model before starting the worker. Photo classification and plan geometry are separate requests; only the plan image enters geometry generation. Both use the same context size to avoid repeated model reloads. The tested 8b model uses about 6.9 GB and partially offloads to CPU on an 8 GB RTX3060Ti. First loading is slow on a 16 GB RAM PC.

Keep the Dockhost persistent disk mounted at `/app/uploads` (or `UPLOAD_DIR`). Photos, sanitized plans under `plans/`, and JSON models under `architecture/` use that disk. Database migrations add separate inputs and jobs without removing legacy artifacts.

The server validates every scene against dimensions, object counts and allowed fields before persistence. Input changes invalidate leased revisions; expired or obsolete completions cannot publish. Published models are public; draft models require ownership. Jobs have three bounded attempts, five-minute renewable leases, one-hour hard deadlines, and bounded image/provider responses.

Validation commands: `npm test`, `npm run test:api`, `npm run test:architecture-browser`, and `python -m unittest discover -s tests -p '*worker_test.py'` in the worker image. Browser tests use known synthetic geometry; they do not establish the accuracy of a supplied real floor plan.
