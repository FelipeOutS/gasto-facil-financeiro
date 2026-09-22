import { randomBytes } from "node:crypto";

// Local fixtures only. Missing/invalid configuration tests explicitly unset
// these values. Never persist or reuse production secrets.
process.env.WHATSAPP_GRAPH_VERSION = "v20.0";
process.env.WHATSAPP_PIX_KEY_ENC_SECRET = randomBytes(32).toString("hex");
