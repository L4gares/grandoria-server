export const QUEST_PROGRESS_SCHEMA_VERSION = 1;
export const QUEST_CATALOG_SCHEMA_VERSION = 1;

export const QUEST_OBJECTIVE_TYPES = [
  "talk",
  "kill",
  "collect",
  "explore",
  "deliver",
] as const;

export type QuestObjectiveType = (typeof QUEST_OBJECTIVE_TYPES)[number];

export type QuestRuntimeState =
  | "locked"
  | "available"
  | "active"
  | "ready"
  | "completed";

export type QuestInitialState = "locked" | "available";

export type QuestTurnIn = {
  type: "npc" | "auto";
  targetId: string;
};

export type QuestObjectiveDefinition = {
  id: string;
  type: QuestObjectiveType;
  targetId: string;
  quantity: number;
  order: number;
};

export type QuestRewardItem = {
  itemId: string;
  quantity: number;
};

export type QuestRewards = {
  xp: number;
  gold: number;
  gem: number;
  items: readonly QuestRewardItem[];
};

export type QuestDialogue = {
  offer: string;
  active: string;
  ready: string;
  completed: string;
};

export type QuestCreditRules = {
  mode: "solo";
};

export type QuestDefinition = {
  questId: string;
  title: string;
  description: string;
  offerNpcId: string;
  turnIn: QuestTurnIn;
  prerequisites: readonly string[];
  objectives: readonly QuestObjectiveDefinition[];
  rewards: QuestRewards;
  nextQuestId: string;
  repeatable: boolean;
  initialState: QuestInitialState;
  dialogue: QuestDialogue;
  trackingAllowed: boolean;
  credit: QuestCreditRules;
};

export type QuestCatalogDocument = {
  catalogSchemaVersion: number;
  definitions: Readonly<Record<string, QuestDefinition>>;
  source?: Readonly<Record<string, unknown>>;
};

export type QuestProgressRecord = {
  state: "active" | "ready" | "completed";
  objectives: Record<string, number>;
  acceptedAt: number;
  completedAt: number;
  completionCount: number;
  lastCompletedAt: number;
};

export type QuestProcessedOperation = {
  action: string;
  at: number;
};

export type QuestProgressData = {
  schemaVersion: number;
  quests: Record<string, QuestProgressRecord>;
  processedRequests: Record<string, QuestProcessedOperation>;
  processedEvents: Record<string, number>;
  trackedQuestId: string;
};

export type QuestObjectiveSnapshot = QuestObjectiveDefinition & {
  current: number;
  complete: boolean;
};

export type QuestSnapshotEntry = {
  questId: string;
  title: string;
  description: string;
  state: QuestRuntimeState;
  objectives: readonly QuestObjectiveSnapshot[];
  rewards: QuestRewards;
  trackingAllowed: boolean;
  tracked: boolean;
  offerNpcId: string;
  turnIn: QuestTurnIn;
  dialogue: QuestDialogue;
  repeatable: boolean;
  completionCount: number;
};

export type QuestNpcMarkerSnapshot = {
  npcId: string;
  displayName: string;
  objectName: string;
  state: "available" | "ready";
};

export type QuestInteractableNpcSnapshot = {
  npcId: string;
  displayName: string;
  objectName: string;
};

export type QuestSnapshot = {
  schemaVersion: number;
  quests: readonly QuestSnapshotEntry[];
  trackedQuestId: string;
  npcMarkers: readonly QuestNpcMarkerSnapshot[];
  interactableNpcs: readonly QuestInteractableNpcSnapshot[];
};
