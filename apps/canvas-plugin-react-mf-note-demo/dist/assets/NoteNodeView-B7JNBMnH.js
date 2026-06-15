import { d as __mf_29, b as __mfDefaultExport } from "./_virtual_mf___mfe_internal__pulse_canvas_demo_note__loadShare__react__loadShare__.js-B8ucmBWv.js";
const accents = ["#2383e2", "#0f766e", "#7c3aed", "#c2410c"];
function readPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const payload = data.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload;
}
function normalizePayload(payload) {
  return {
    title: typeof payload.title === "string" && payload.title.trim() ? payload.title : "External React plugin",
    body: typeof payload.body === "string" ? payload.body : "This node view is rendered by a user-owned MF remote.",
    accent: typeof payload.accent === "string" && payload.accent ? payload.accent : accents[0],
    pinned: payload.pinned === true
  };
}
function NoteNodeView({ node, readOnly, selected, updateNode }) {
  const payload = normalizePayload(readPayload(node.data));
  const wordCount = __mf_29(
    () => payload.body.trim().split(/\s+/).filter(Boolean).length,
    [payload.body]
  );
  const patchPayload = (patch) => {
    if (readOnly) return;
    const data = node.data && typeof node.data === "object" && !Array.isArray(node.data) ? node.data : {};
    updateNode({
      data: {
        ...data,
        payload: {
          ...payload,
          ...patch
        }
      }
    });
  };
  return /* @__PURE__ */ __mfDefaultExport.createElement(
    "div",
    {
      style: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 18,
        boxSizing: "border-box",
        background: "#fff",
        borderTop: `4px solid ${payload.accent}`,
        boxShadow: selected ? `inset 0 0 0 1px ${payload.accent}` : "none"
      }
    },
    /* @__PURE__ */ __mfDefaultExport.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } }, /* @__PURE__ */ __mfDefaultExport.createElement("div", null, /* @__PURE__ */ __mfDefaultExport.createElement(
      "div",
      {
        style: {
          fontSize: 11,
          fontWeight: 700,
          color: payload.accent,
          textTransform: "uppercase"
        }
      },
      "React MF / demo.note"
    ), /* @__PURE__ */ __mfDefaultExport.createElement(
      "input",
      {
        value: payload.title,
        readOnly,
        onChange: (event) => patchPayload({ title: event.target.value }),
        style: {
          marginTop: 8,
          width: "100%",
          border: 0,
          padding: 0,
          outline: "none",
          background: "transparent",
          color: "#1f2328",
          fontFamily: "inherit",
          fontSize: 18,
          fontWeight: 750,
          lineHeight: 1.25
        }
      }
    )), /* @__PURE__ */ __mfDefaultExport.createElement(
      "button",
      {
        type: "button",
        disabled: readOnly,
        onClick: () => patchPayload({ pinned: !payload.pinned }),
        style: {
          height: 30,
          borderRadius: 8,
          border: "1px solid rgba(55, 53, 47, 0.12)",
          background: payload.pinned ? "rgba(35, 131, 226, 0.1)" : "#fff",
          color: payload.pinned ? payload.accent : "rgba(55, 53, 47, 0.65)",
          cursor: readOnly ? "not-allowed" : "pointer",
          fontSize: 12,
          fontWeight: 700,
          padding: "0 10px"
        }
      },
      payload.pinned ? "Pinned" : "Pin"
    )),
    /* @__PURE__ */ __mfDefaultExport.createElement(
      "textarea",
      {
        value: payload.body,
        readOnly,
        onChange: (event) => patchPayload({ body: event.target.value }),
        style: {
          flex: 1,
          minHeight: 0,
          width: "100%",
          resize: "none",
          border: "1px solid rgba(55, 53, 47, 0.1)",
          borderRadius: 8,
          padding: 12,
          outline: "none",
          boxSizing: "border-box",
          color: "#37352f",
          background: "#fbfbfa",
          fontFamily: "inherit",
          fontSize: 13,
          lineHeight: 1.5
        }
      }
    ),
    /* @__PURE__ */ __mfDefaultExport.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } }, /* @__PURE__ */ __mfDefaultExport.createElement("div", { style: { display: "flex", gap: 6 } }, accents.map((accent) => /* @__PURE__ */ __mfDefaultExport.createElement(
      "button",
      {
        key: accent,
        type: "button",
        "aria-label": `Use ${accent}`,
        disabled: readOnly,
        onClick: () => patchPayload({ accent }),
        style: {
          width: 18,
          height: 18,
          borderRadius: 9,
          border: accent === payload.accent ? "2px solid #1f2328" : "1px solid rgba(55, 53, 47, 0.16)",
          background: accent,
          cursor: readOnly ? "not-allowed" : "pointer"
        }
      }
    ))), /* @__PURE__ */ __mfDefaultExport.createElement("div", { style: { fontSize: 11, color: "rgba(55, 53, 47, 0.5)" } }, wordCount, " words"))
  );
}
export {
  NoteNodeView as N
};
