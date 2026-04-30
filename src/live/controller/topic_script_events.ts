export const TOPIC_SCRIPT_EVENT_TYPES = [
  "topic_script.generated",
  "topic_script.compiled",
  "topic_script.approved",
  "topic_script.section_started",
  "topic_script.section_completed",
  "topic_script.interrupted",
  "topic_script.fallback_used",
] as const;

export type TopicScriptEventType = typeof TOPIC_SCRIPT_EVENT_TYPES[number];
