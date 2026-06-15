const DEFAULT_PAYLOAD = {
  title: "External React plugin",
  body: "This node can expose semantic read/write/action capabilities to the Canvas Agent.",
  accent: "#2383e2"
};
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readPayload(ref) {
  const data = isRecord(ref.node.data) ? ref.node.data : {};
  const payload = isRecord(data.payload) ? data.payload : {};
  return normalizePayload(payload);
}
function normalizePayload(value) {
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : DEFAULT_PAYLOAD.title,
    body: typeof value.body === "string" ? value.body : DEFAULT_PAYLOAD.body,
    accent: typeof value.accent === "string" && value.accent.trim() ? value.accent.trim() : DEFAULT_PAYLOAD.accent,
    pinned: value.pinned === true
  };
}
function payloadFromWriteInput(input) {
  if (isRecord(input.payload)) return input.payload;
  return {};
}
const mainPlugin = {
  id: "demo-note",
  activate(ctx) {
    ctx.registerNodeCapabilities("demo.note", {
      read(ref) {
        const payload = readPayload(ref);
        const pinnedLabel = payload.pinned ? "pinned" : "not pinned";
        return {
          payload,
          summary: `${payload.title} (${pinnedLabel})`,
          content: [
            `Demo note: ${payload.title}`,
            `Status: ${pinnedLabel}`,
            `Body: ${payload.body}`
          ].join("\n"),
          availableActions: ["pin"]
        };
      },
      write(ref, input) {
        return {
          title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : void 0,
          payload: normalizePayload({
            ...readPayload(ref),
            ...payloadFromWriteInput(input)
          })
        };
      },
      actions: {
        pin(ref, input) {
          const current = readPayload(ref);
          const nextPinned = isRecord(input) && typeof input.pinned === "boolean" ? input.pinned : !current.pinned;
          const payload = normalizePayload({
            ...current,
            pinned: nextPinned
          });
          return {
            patch: { payload },
            result: { ok: true, pinned: nextPinned }
          };
        }
      }
    });
  }
};
export {
  mainPlugin as default,
  mainPlugin
};
