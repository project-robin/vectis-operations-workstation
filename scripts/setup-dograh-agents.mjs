#!/usr/bin/env node
/**
 * One-time (idempotent) wiring between Dograh, Convex, and Twenty.
 *
 *   node scripts/setup-dograh-agents.mjs [--lead-workflow-id 11741]
 *
 * 1. Creates/updates the "Vectis Custom Call" Dograh agent used by Quick Call
 *    (API trigger + post-call webhook back to Convex).
 * 2. Adds the same post-call webhook to the lead-calling agent.
 * 3. Writes DOGRAH_* / TWENTY_* / VECTIS_* values into the Convex deployment env.
 *
 * Reads keys from the environment or .env.local (DOGRAH_API_KEY | dogrha_api,
 * TWENTY_API_KEY | twenty_CRM, NEXT_PUBLIC_CONVEX_SITE_URL).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const QUICK_CALL_NAME = "Vectis Custom Call";
const END_CALL_TOOL_NAME = "end_call";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = loadEnvFile(".env.local");
const pick = (...names) =>
  names
    .map((n) => process.env[n] ?? fileEnv[n])
    .find((v) => v && v.trim())
    ?.trim();

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const DOGRAH_API_URL = (pick("DOGRAH_API_URL") ?? "https://api.dograh.com").replace(/\/+$/, "");
const DOGRAH_API_KEY = pick("DOGRAH_API_KEY", "dogrha_api");
const TWENTY_API_KEY = pick("TWENTY_API_KEY", "twenty_CRM");
const TWENTY_API_URL = pick("TWENTY_API_URL") ?? "https://api.twenty.com";
const SITE_URL = pick("NEXT_PUBLIC_CONVEX_SITE_URL")?.replace(/\/+$/, "");
const leadWorkflowId =
  Number(argValue("--lead-workflow-id") ?? pick("DOGRAH_LEAD_WORKFLOW_ID") ?? 0) || undefined;

if (!DOGRAH_API_KEY) throw new Error("Missing DOGRAH_API_KEY (or dogrha_api) in env/.env.local");
if (!SITE_URL) throw new Error("Missing NEXT_PUBLIC_CONVEX_SITE_URL in env/.env.local");

function convexEnv(action, ...rest) {
  return execFileSync("npx", ["convex", "env", action, ...rest], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function convexEnvGet(name) {
  try {
    return convexEnv("get", name) || undefined;
  } catch {
    return undefined;
  }
}

async function dograh(method, path, body) {
  const response = await fetch(`${DOGRAH_API_URL}/api/v1${path}`, {
    method,
    headers: { "X-API-Key": DOGRAH_API_KEY, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`Dograh ${method} ${path} -> ${response.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

const secret = convexEnvGet("VECTIS_DOGRAH_WEBHOOK_SECRET") ?? randomBytes(24).toString("hex");
const webhookUrl = `${SITE_URL}/dograh/call-events`;

function webhookNode(id, position) {
  return {
    id,
    type: "webhook",
    position,
    data: {
      name: "Vectis call results",
      enabled: true,
      http_method: "POST",
      endpoint_url: webhookUrl,
      custom_headers: [{ key: "X-Vectis-Secret", value: secret }],
      payload_template: {
        event: "call_completed",
        workflow_run_id: "{{workflow_run_id}}",
        vectis_call_id: "{{initial_context.vectis_call_id}}",
      },
    },
  };
}

// Extraction runs when the call leaves a node and at hang-up, over the conversation so far,
// so the last node reached always leaves a whole-call summary.
const REPORT_VARIABLES = [
  {
    name: "call_summary",
    type: "string",
    prompt:
      "A 2-4 sentence summary of the whole call so far for the business owner: who they are, what they said, and the outcome.",
  },
  {
    name: "follow_up_required",
    type: "boolean",
    prompt:
      "true if the person asked for a callback, showed interest that needs a human, or something is unresolved; otherwise false.",
  },
];

function withReportExtraction(node) {
  if (node.type !== "startCall" && node.type !== "agentNode") return node;
  const current = node.data.extraction_variables ?? [];
  const missing = REPORT_VARIABLES.filter((v) => !current.some((c) => c.name === v.name));
  if (missing.length === 0 && node.data.extraction_enabled) return node;
  return {
    ...node,
    data: {
      ...node.data,
      extraction_enabled: true,
      extraction_prompt:
        node.data.extraction_prompt ||
        "Extract what was learned on this call for the business owner. Use empty values when nothing was said.",
      extraction_variables: [...current, ...missing],
    },
  };
}

function quickCallDefinition(endCallToolUuid, triggerPath) {
  const tools = endCallToolUuid ? [endCallToolUuid] : [];
  const node = (id, type, x, y, data) => ({ id, type, position: { x, y }, data });
  const edge = (source, target, label, condition) => ({
    id: `${source}-${target}`,
    source,
    target,
    data: { label, condition },
  });
  return {
    nodes: [
      node("1", "globalNode", 0, 0, {
        name: "Vectis Persona",
        prompt: [
          "# Identity",
          "You are a warm, calm automated voice assistant calling on behalf of {{business_name}}. If asked, say plainly that you are an automated assistant for {{business_name}}. Never claim to be human.",
          "",
          "# Style",
          "Speak simple, natural, conversational English. Keep each turn to one or two short sentences and ask one question at a time, then wait. Let the person finish speaking. Do not repeat what they already told you. Confirm numbers, dates and names back when they matter.",
          "",
          "# Guardrails",
          "Only ask about what the brief from {{business_name}} covers. Never give medical, legal or financial advice, never diagnose, and never promise anything on behalf of {{business_name}}. If the person describes an emergency or severe symptoms, tell them to contact {{business_name}} or local emergency services right away, note it, and wrap up. If the person wants to stop, is busy, or it's the wrong person, say a brief goodbye and invoke end_call.",
        ].join("\n"),
      }),
      node("2", "startCall", 0, 150, {
        name: "Greeting",
        greeting_type: "text",
        greeting:
          "Hello, this is the automated assistant calling on behalf of {{business_name}}. Is now a good time to talk for a couple of minutes?",
        prompt: [
          "# Goal",
          "Confirm you are speaking with the right person and that they have a couple of minutes.",
          "The person's name, if known, is: {{contact_name}}. Only use it if it looks like a real name.",
          "Reason for the call (from {{business_name}}): {{call_brief}}",
          "If they ask why you're calling, explain the reason in one short sentence based on the brief.",
          "",
          "# Transitions",
          "If they agree to talk, move on to the questions. If they are busy or ask to be called later, wrap up politely. If it's the wrong person or they refuse, end politely.",
        ].join("\n"),
        allow_interrupt: true,
        add_global_prompt: true,
        delayed_start: false,
        extraction_enabled: false,
        tool_uuids: tools,
        pre_call_fetch_mode: "disabled",
      }),
      node("3", "agentNode", 400, 300, {
        name: "Ask Questions",
        prompt: [
          "# Goal",
          "{{business_name}} wants to learn the following from this person:",
          '"{{call_brief}}"',
          "",
          "# How",
          "1. Turn the brief into short, clear questions. Ask them one at a time, in a sensible order.",
          "2. Listen to each answer. Ask one short follow-up only if the answer is unclear or incomplete.",
          "3. If they don't want to answer something, accept it and move on.",
          "4. When every point in the brief is covered, ask whether there's anything they'd like you to pass on to {{business_name}}.",
          "5. Then thank them and wrap up.",
          "Do not ask about anything the brief does not cover.",
        ].join("\n"),
        allow_interrupt: true,
        add_global_prompt: true,
        extraction_enabled: true,
        extraction_prompt:
          "Extract what was learned on this call for the business owner. Be factual and use the person's own words where possible. Use empty strings when nothing was said.",
        extraction_variables: [
          {
            name: "call_summary",
            type: "string",
            prompt:
              "A 2-4 sentence summary of the call for the business owner, with the most important facts learned.",
          },
          {
            name: "answers",
            type: "string",
            prompt:
              "Each question you asked and the person's answer, one per line in the form 'Q: ... — A: ...'. Write 'not answered' where they declined.",
          },
          {
            name: "follow_up_required",
            type: "boolean",
            prompt:
              "true if the person asked for a callback, raised a problem or concern that needs a human, or something important is unresolved; otherwise false.",
          },
          {
            name: "message_for_business",
            type: "string",
            prompt: "Any message the person asked to pass on to the business. Empty if none.",
          },
        ],
        tool_uuids: tools,
      }),
      node("4", "endCall", 800, 450, {
        name: "Wrap Up",
        prompt:
          "Thank them warmly, say you'll pass this on to {{business_name}}, and say goodbye in one short sentence. Do not ask another question.",
        add_global_prompt: false,
        extraction_enabled: false,
      }),
      node("5", "endCall", 400, 0, {
        name: "Call Back Later",
        prompt:
          "Say no problem, {{business_name}} may reach out another time, and say goodbye in one short sentence. Do not ask another question.",
        add_global_prompt: false,
        extraction_enabled: false,
      }),
      node("6", "endCall", 400, 600, {
        name: "Declined or Wrong Person",
        prompt:
          "Apologize for the interruption and say goodbye in one short sentence. Do not pitch or ask anything else.",
        add_global_prompt: false,
        extraction_enabled: false,
      }),
      node("7", "trigger", -400, 150, {
        name: "Vectis API Trigger",
        enabled: true,
        trigger_path: triggerPath,
      }),
      webhookNode("8", { x: 1200, y: 450 }),
    ],
    edges: [
      edge(
        "2",
        "3",
        "ready to talk",
        "The person agrees to talk, confirms they are the right person, or engages with the reason for the call.",
      ),
      edge(
        "2",
        "5",
        "busy",
        "The person is busy, driving, in a meeting, or asks to be called later.",
      ),
      edge(
        "2",
        "6",
        "declined",
        "Wrong number or wrong person, the person refuses, or asks not to be called.",
      ),
      edge(
        "3",
        "4",
        "brief covered",
        "Every point in the brief has been asked (answered or declined) and the person has nothing more to add.",
      ),
      edge("3", "5", "needs to go", "The person needs to leave before the questions are finished."),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function main() {
  const tools = await dograh("GET", "/tools/");
  const endCallTool = tools.find(
    (tool) => tool.category === END_CALL_TOOL_NAME || tool.name === END_CALL_TOOL_NAME,
  );
  const workflows = await dograh("GET", "/workflow/fetch");

  // 1. Quick call agent
  let quick = workflows.find((wf) => wf.name === QUICK_CALL_NAME);
  let triggerPath =
    convexEnvGet("DOGRAH_QUICK_CALL_TRIGGER_PATH") ??
    `vectis-quick-${randomBytes(4).toString("hex")}`;
  const definition = quickCallDefinition(endCallTool?.tool_uuid, triggerPath);
  if (!quick) {
    const created = await dograh("POST", "/workflow/create/definition", {
      name: QUICK_CALL_NAME,
      workflow_definition: definition,
    });
    quick = { id: created.id, name: created.name };
    console.log(`Created Dograh agent "${QUICK_CALL_NAME}" (#${quick.id})`);
  } else {
    await dograh("POST", `/workflow/${quick.id}/create-draft`).catch(() => undefined);
    await dograh("PUT", `/workflow/${quick.id}`, {
      name: QUICK_CALL_NAME,
      workflow_definition: definition,
    });
    console.log(`Updated Dograh agent "${QUICK_CALL_NAME}" (#${quick.id})`);
  }
  await dograh("POST", `/workflow/${quick.id}/publish`).catch((error) => {
    if (!/no draft/i.test(String(error.message))) throw error;
  });
  const published = await dograh("GET", `/workflow/fetch/${quick.id}`);
  const trigger = published.workflow_definition?.nodes?.find((n) => n.type === "trigger");
  triggerPath = trigger?.data?.trigger_path ?? triggerPath;
  console.log(
    `  version ${published.version_number} (${published.version_status}), trigger path ${triggerPath}`,
  );

  // 2. Lead agent: post-call webhook + summary extraction so every call report is filled in
  if (leadWorkflowId) {
    const lead = await dograh("GET", `/workflow/fetch/${leadWorkflowId}`);
    const nodes = lead.workflow_definition?.nodes ?? [];
    const existing = nodes.find((n) => n.type === "webhook" && n.data?.endpoint_url === webhookUrl);
    const hook = webhookNode(
      existing?.id ?? String(Math.max(0, ...nodes.map((n) => Number(n.id) || 0)) + 1),
      existing?.position ?? { x: 1600, y: 600 },
    );
    let nextNodes = existing
      ? nodes.map((n) => (n.id === existing.id ? hook : n))
      : [...nodes, hook];
    nextNodes = nextNodes.map(withReportExtraction);
    if (JSON.stringify(nextNodes) !== JSON.stringify(nodes)) {
      await dograh("POST", `/workflow/${leadWorkflowId}/create-draft`).catch(() => undefined);
      await dograh("PUT", `/workflow/${leadWorkflowId}`, {
        workflow_definition: { ...lead.workflow_definition, nodes: nextNodes },
      });
      await dograh("POST", `/workflow/${leadWorkflowId}/publish`);
      console.log(
        `Lead agent "${lead.name}" (#${leadWorkflowId}) now reports call results to Vectis`,
      );
    } else {
      console.log(`Lead agent "${lead.name}" (#${leadWorkflowId}) already reports to Vectis`);
    }
  }

  // 3. Convex deployment environment
  const envValues = {
    DOGRAH_API_URL,
    DOGRAH_API_KEY,
    DOGRAH_QUICK_CALL_WORKFLOW_ID: String(quick.id),
    DOGRAH_QUICK_CALL_TRIGGER_PATH: triggerPath,
    VECTIS_DOGRAH_WEBHOOK_SECRET: secret,
    ...(leadWorkflowId ? { DOGRAH_LEAD_WORKFLOW_ID: String(leadWorkflowId) } : {}),
    ...(TWENTY_API_KEY ? { TWENTY_API_KEY, TWENTY_API_URL } : {}),
  };
  for (const [name, value] of Object.entries(envValues)) {
    if (convexEnvGet(name) !== value) convexEnv("set", name, value);
  }
  console.log(`Convex environment updated: ${Object.keys(envValues).join(", ")}`);
  console.log(`Webhook endpoint: ${webhookUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
