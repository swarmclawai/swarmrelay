import type { AgentAuthPayload, DashboardAuthPayload } from '@swarmrelay/shared';

export type AuthEnv = {
  Variables: {
    auth: AgentAuthPayload | DashboardAuthPayload;
  };
};
