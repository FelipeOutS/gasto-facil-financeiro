import type { ComponentType } from "react";

export interface TemplateEntry {
  component: ComponentType<any>;
  subject: string | ((data: Record<string, any>) => string);
  displayName?: string;
  previewData?: Record<string, any>;
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string;
}

import { template as connectedAccountInvite } from "./connected-account-invite";

export const TEMPLATES: Record<string, TemplateEntry> = {
  "connected-account-invite": connectedAccountInvite,
};
