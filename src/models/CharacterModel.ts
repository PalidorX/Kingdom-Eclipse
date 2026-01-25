export interface CharacterStats {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  attack: number;
  defense: number;
  dexterity: number;
  intelligence: number;
}

export interface CharacterAppearance {
  spritesheetKey: string;
  frameIndex: number;
  tint?: number;
}

export type CharacterClass = 'warrior' | 'mage' | 'archer' | 'healer' | 'tank';
export type CharacterRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface CharacterSkill {
  id: string;
  name: string;
  description: string;
  manaCost: number;
  cooldown: number;
  type: 'damage' | 'heal' | 'buff' | 'debuff';
  targetType: 'self' | 'ally' | 'enemy' | 'all_enemies' | 'all_allies';
  power: number;
}

export class CharacterModel {
  public id: string;
  public name: string;
  public level: number;
  public experience: number;
  public characterClass: CharacterClass;
  public rarity: CharacterRarity;
  public stats: CharacterStats;
  public baseStats: CharacterStats;
  public appearance: CharacterAppearance;
  public skills: CharacterSkill[];
  public isRecruited: boolean;

  constructor(config: {
    id: string;
    name: string;
    characterClass: CharacterClass;
    rarity?: CharacterRarity;
    level?: number;
    appearance?: Partial<CharacterAppearance>;
  }) {
    this.id = config.id;
    this.name = config.name;
    this.characterClass = config.characterClass;
    this.rarity = config.rarity || 'common';
    this.level = config.level || 1;
    this.experience = 0;
    this.isRecruited = false;

    this.baseStats = this.generateBaseStats();
    this.stats = { ...this.baseStats };
    this.appearance = {
      spritesheetKey: config.appearance?.spritesheetKey || 'char-ally',
      frameIndex: config.appearance?.frameIndex || 0,
      tint: config.appearance?.tint,
    };
    this.skills = this.generateSkills();
  }

  private generateBaseStats(): CharacterStats {
    const rarityMultiplier = this.getRarityMultiplier();
    const classStats = this.getClassBaseStats();

    return {
      hp: Math.floor(classStats.hp * rarityMultiplier),
      maxHp: Math.floor(classStats.hp * rarityMultiplier),
      mana: 0,
      maxMana: 100,
      attack: Math.floor(classStats.attack * rarityMultiplier),
      defense: Math.floor(classStats.defense * rarityMultiplier),
      dexterity: Math.floor(classStats.dexterity * rarityMultiplier),
      intelligence: Math.floor(classStats.intelligence * rarityMultiplier),
    };
  }

  private getRarityMultiplier(): number {
    const multipliers: Record<CharacterRarity, number> = {
      common: 1.0,
      uncommon: 1.15,
      rare: 1.3,
      epic: 1.5,
      legendary: 1.8,
    };
    return multipliers[this.rarity];
  }

  private getClassBaseStats(): Omit<CharacterStats, 'maxHp' | 'mana' | 'maxMana'> {
    const classStats: Record<CharacterClass, Omit<CharacterStats, 'maxHp' | 'mana' | 'maxMana'>> = {
      warrior: { hp: 120, attack: 15, defense: 12, dexterity: 8, intelligence: 5 },
      mage: { hp: 70, attack: 8, defense: 5, dexterity: 7, intelligence: 18 },
      archer: { hp: 80, attack: 14, defense: 6, dexterity: 15, intelligence: 8 },
      healer: { hp: 75, attack: 6, defense: 8, dexterity: 6, intelligence: 15 },
      tank: { hp: 150, attack: 10, defense: 18, dexterity: 5, intelligence: 5 },
    };
    return classStats[this.characterClass];
  }

  private generateSkills(): CharacterSkill[] {
    const classSkills: Record<CharacterClass, CharacterSkill[]> = {
      warrior: [
        {
          id: 'cleave',
          name: 'Cleave',
          description: 'Deals damage to all enemies',
          manaCost: 100,
          cooldown: 0,
          type: 'damage',
          targetType: 'all_enemies',
          power: 1.5,
        },
      ],
      mage: [
        {
          id: 'fireball',
          name: 'Fireball',
          description: 'Massive magical damage to all enemies',
          manaCost: 100,
          cooldown: 0,
          type: 'damage',
          targetType: 'all_enemies',
          power: 2.5,
        },
      ],
      archer: [
        {
          id: 'volley',
          name: 'Arrow Volley',
          description: 'Rapid attacks on random enemies',
          manaCost: 100,
          cooldown: 0,
          type: 'damage',
          targetType: 'all_enemies',
          power: 1.8,
        },
      ],
      healer: [
        {
          id: 'mass_heal',
          name: 'Mass Heal',
          description: 'Heals all allies',
          manaCost: 100,
          cooldown: 0,
          type: 'heal',
          targetType: 'all_allies',
          power: 2.0,
        },
      ],
      tank: [
        {
          id: 'fortify',
          name: 'Fortify',
          description: 'Increases defense of all allies',
          manaCost: 100,
          cooldown: 0,
          type: 'buff',
          targetType: 'all_allies',
          power: 1.5,
        },
      ],
    };
    return classSkills[this.characterClass];
  }

  public gainExperience(amount: number): boolean {
    this.experience += amount;
    const expNeeded = this.getExperienceForNextLevel();

    if (this.experience >= expNeeded) {
      this.levelUp();
      return true;
    }
    return false;
  }

  private getExperienceForNextLevel(): number {
    return Math.floor(100 * Math.pow(1.5, this.level - 1));
  }

  private levelUp(): void {
    this.level++;
    this.experience = 0;

    // Increase stats
    const growthRate = 1.1;
    this.baseStats.hp = Math.floor(this.baseStats.hp * growthRate);
    this.baseStats.maxHp = this.baseStats.hp;
    this.baseStats.attack = Math.floor(this.baseStats.attack * growthRate);
    this.baseStats.defense = Math.floor(this.baseStats.defense * growthRate);
    this.baseStats.dexterity = Math.floor(this.baseStats.dexterity * growthRate);
    this.baseStats.intelligence = Math.floor(this.baseStats.intelligence * growthRate);

    // Restore HP and mana on level up
    this.stats = { ...this.baseStats, mana: 0 };
  }

  public heal(amount: number): void {
    this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + amount);
  }

  public takeDamage(amount: number): boolean {
    const actualDamage = Math.max(1, amount - this.stats.defense / 2);
    this.stats.hp -= actualDamage;
    return this.stats.hp <= 0;
  }

  public toJSON(): CharacterSaveData {
    return {
      id: this.id,
      name: this.name,
      level: this.level,
      experience: this.experience,
      characterClass: this.characterClass,
      rarity: this.rarity,
      stats: this.stats,
      baseStats: this.baseStats,
      appearance: this.appearance,
      isRecruited: this.isRecruited,
    };
  }

  public static fromJSON(data: CharacterSaveData): CharacterModel {
    const char = new CharacterModel({
      id: data.id,
      name: data.name,
      characterClass: data.characterClass,
      rarity: data.rarity,
      level: data.level,
    });
    char.experience = data.experience;
    char.stats = data.stats;
    char.baseStats = data.baseStats;
    char.isRecruited = data.isRecruited;
    return char;
  }
}

export interface CharacterSaveData {
  id: string;
  name: string;
  level: number;
  experience: number;
  characterClass: CharacterClass;
  rarity: CharacterRarity;
  stats: CharacterStats;
  baseStats: CharacterStats;
  appearance: CharacterAppearance;
  isRecruited: boolean;
}
