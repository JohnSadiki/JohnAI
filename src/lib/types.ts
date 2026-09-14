export type Role = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
};

export type ToolEvent = {
  id: string;
  name: string;
  status: 'started' | 'progress' | 'completed' | 'error';
  detail?: string;
  at: number;
};

export type Session = {
  id: string;
  title: string;
  messages: ChatMessage[];
  toolEvents: ToolEvent[];
  updatedAt: number;
  hermesSessionId?: string;
};

export type HealthState = 'unknown' | 'ok' | 'error';

export type SkillInfo = { name: string; description?: string; category?: string };
export type ToolsetInfo = {
  name: string;
  label?: string;
  description?: string;
  enabled?: boolean;
  configured?: boolean;
  tools?: string[];
};
