export type QuestType = 'main' | 'side' | 'daily' | 'visitor';
export type QuestStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'claimed';

export type QuestTriggerType =
  | 'walk_distance'
  | 'defeat_enemies'
  | 'collect_resources'
  | 'build_buildings'
  | 'upgrade_buildings'
  | 'recruit_units'
  | 'complete_dungeons'
  | 'reach_kingdom_level';

export interface QuestTrigger {
  type: QuestTriggerType;
  target: number;
  current: number;
  resourceType?: string;
  buildingType?: string;
}

export interface QuestReward {
  gold?: number;
  wood?: number;
  stone?: number;
  food?: number;
  experience?: number;
  characterId?: string;
  itemId?: string;
}

export interface QuestPrerequisite {
  questId?: string;
  kingdomLevel?: number;
  buildingType?: string;
  buildingLevel?: number;
}

export class QuestModel {
  public id: string;
  public name: string;
  public description: string;
  public type: QuestType;
  public status: QuestStatus;
  public triggers: QuestTrigger[];
  public rewards: QuestReward;
  public prerequisites: QuestPrerequisite[];
  public expiresAt?: number;
  public completedAt?: number;

  constructor(config: {
    id: string;
    name: string;
    description: string;
    type: QuestType;
    triggers: Omit<QuestTrigger, 'current'>[];
    rewards: QuestReward;
    prerequisites?: QuestPrerequisite[];
    expiresAt?: number;
  }) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.type = config.type;
    this.status = 'locked';
    this.triggers = config.triggers.map((t) => ({ ...t, current: 0 }));
    this.rewards = config.rewards;
    this.prerequisites = config.prerequisites || [];
    this.expiresAt = config.expiresAt;
  }

  public checkPrerequisites(gameState: {
    completedQuests: string[];
    kingdomLevel: number;
    buildings: { type: string; level: number }[];
  }): boolean {
    for (const prereq of this.prerequisites) {
      if (prereq.questId && !gameState.completedQuests.includes(prereq.questId)) {
        return false;
      }
      if (prereq.kingdomLevel && gameState.kingdomLevel < prereq.kingdomLevel) {
        return false;
      }
      if (prereq.buildingType) {
        const building = gameState.buildings.find((b) => b.type === prereq.buildingType);
        if (!building) return false;
        if (prereq.buildingLevel && building.level < prereq.buildingLevel) {
          return false;
        }
      }
    }
    return true;
  }

  public unlock(): boolean {
    if (this.status !== 'locked') return false;
    this.status = 'available';
    return true;
  }

  public start(): boolean {
    if (this.status !== 'available') return false;
    this.status = 'in_progress';
    return true;
  }

  public updateProgress(triggerType: QuestTriggerType, amount: number, metadata?: {
    resourceType?: string;
    buildingType?: string;
  }): boolean {
    if (this.status !== 'in_progress') return false;

    let updated = false;

    for (const trigger of this.triggers) {
      if (trigger.type !== triggerType) continue;

      // Check metadata matches if required
      if (trigger.resourceType && trigger.resourceType !== metadata?.resourceType) continue;
      if (trigger.buildingType && trigger.buildingType !== metadata?.buildingType) continue;

      trigger.current = Math.min(trigger.target, trigger.current + amount);
      updated = true;
    }

    // Check if all triggers are complete
    if (this.isComplete()) {
      this.status = 'completed';
      this.completedAt = Date.now();
    }

    return updated;
  }

  public isComplete(): boolean {
    return this.triggers.every((t) => t.current >= t.target);
  }

  public getProgress(): number {
    if (this.triggers.length === 0) return 1;

    const totalProgress = this.triggers.reduce((sum, t) => sum + t.current / t.target, 0);
    return totalProgress / this.triggers.length;
  }

  public claimRewards(): QuestReward | null {
    if (this.status !== 'completed') return null;
    this.status = 'claimed';
    return this.rewards;
  }

  public isExpired(): boolean {
    if (!this.expiresAt) return false;
    return Date.now() > this.expiresAt;
  }

  public getTimeRemaining(): number | null {
    if (!this.expiresAt) return null;
    return Math.max(0, this.expiresAt - Date.now());
  }

  public toJSON(): QuestSaveData {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      type: this.type,
      status: this.status,
      triggers: this.triggers,
      rewards: this.rewards,
      prerequisites: this.prerequisites,
      expiresAt: this.expiresAt,
      completedAt: this.completedAt,
    };
  }

  public static fromJSON(data: QuestSaveData): QuestModel {
    const quest = new QuestModel({
      id: data.id,
      name: data.name,
      description: data.description,
      type: data.type,
      triggers: data.triggers,
      rewards: data.rewards,
      prerequisites: data.prerequisites,
      expiresAt: data.expiresAt,
    });
    quest.status = data.status;
    quest.triggers = data.triggers;
    quest.completedAt = data.completedAt;
    return quest;
  }

  // Factory methods for common quest types
  public static createWalkQuest(distance: number, rewards: QuestReward): QuestModel {
    return new QuestModel({
      id: `walk-${distance}-${Date.now()}`,
      name: `Walk ${distance}m`,
      description: `Walk ${distance} meters in the real world.`,
      type: 'daily',
      triggers: [{ type: 'walk_distance', target: distance }],
      rewards,
    });
  }

  public static createDefeatQuest(count: number, rewards: QuestReward): QuestModel {
    return new QuestModel({
      id: `defeat-${count}-${Date.now()}`,
      name: `Defeat ${count} Enemies`,
      description: `Defeat ${count} enemies in battle.`,
      type: 'daily',
      triggers: [{ type: 'defeat_enemies', target: count }],
      rewards,
    });
  }

  public static createCollectQuest(
    resourceType: string,
    amount: number,
    rewards: QuestReward
  ): QuestModel {
    return new QuestModel({
      id: `collect-${resourceType}-${amount}-${Date.now()}`,
      name: `Collect ${amount} ${resourceType}`,
      description: `Collect ${amount} ${resourceType} from the world.`,
      type: 'daily',
      triggers: [{ type: 'collect_resources', target: amount, resourceType }],
      rewards,
    });
  }

  public static createVisitorQuest(
    visitorName: string,
    requirements: QuestTrigger[],
    characterId: string
  ): QuestModel {
    return new QuestModel({
      id: `visitor-${characterId}`,
      name: `Recruit ${visitorName}`,
      description: `Complete the requirements to recruit ${visitorName} to your kingdom.`,
      type: 'visitor',
      triggers: requirements,
      rewards: { characterId },
    });
  }
}

export interface QuestSaveData {
  id: string;
  name: string;
  description: string;
  type: QuestType;
  status: QuestStatus;
  triggers: QuestTrigger[];
  rewards: QuestReward;
  prerequisites: QuestPrerequisite[];
  expiresAt?: number;
  completedAt?: number;
}
