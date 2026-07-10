import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { geo } from '../core/geo';
import { getMapData } from '../core/osm';
import { store } from '../core/save';

const STORY =
  'When the ancient World Crystal shattered, its corruption spread\n' +
  'across the land, birthing monsters from the blight.\n\n' +
  'The surviving kingdoms raised their cities into the sky.\n\n' +
  'Through a network of waypoints, elite knights descend to\n' +
  'reclaim lost territory, cleanse corrupted dungeons, and\n' +
  'recover shards of the Crystal.\n\n' +
  'The world below is your world. The streets are your streets.\n\n' +
  'Descend, knight.';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    this.load.image('world-tileset', `${import.meta.env.BASE_URL}assets/world-tileset.png`);
  }

  async create(): Promise<void> {
    store.load();
    const offline = store.collectOffline();

    const bar = this.add.graphics();
    const barY = GAME_HEIGHT - 120;
    const status = this.add.text(GAME_WIDTH / 2, barY + 26, 'Waking the waypoint...', {
      fontSize: '11px', color: '#88aacc', fontFamily: 'monospace',
    }).setOrigin(0.5);

    const setProgress = (p: number, msg: string) => {
      status.setText(msg);
      bar.clear();
      bar.fillStyle(0x1c2c4c, 1);
      bar.fillRoundedRect(40, barY, GAME_WIDTH - 80, 10, 5);
      bar.fillStyle(0x4a90d9, 1);
      bar.fillRoundedRect(40, barY, (GAME_WIDTH - 80) * p, 10, 5);
    };

    this.add.text(GAME_WIDTH / 2, 110, 'KINGDOM\nECLIPSE', {
      fontSize: '34px', color: '#e8c860', fontFamily: 'monospace', fontStyle: 'bold', align: 'center',
    }).setOrigin(0.5);

    const firstRun = !store.state.introSeen;
    if (firstRun) {
      this.add.text(GAME_WIDTH / 2, 330, STORY, {
        fontSize: '11px', color: '#b8c8e0', fontFamily: 'monospace', align: 'center', lineSpacing: 2,
      }).setOrigin(0.5);
      store.state.introSeen = true;
    }

    setProgress(0.15, 'Acquiring your position...');
    if (store.state.admin.enabled && store.state.admin.pos) {
      geo.setAdmin(store.state.admin.pos);
    }
    await geo.acquire();
    geo.startWatch();

    setProgress(0.5, 'Scrying the world below (map data)...');
    const map = await getMapData(geo.pos);
    this.registry.set('mapData', map); // null -> WorldScene synthesizes terrain

    if (offline.wood > 0 || offline.stone > 0) {
      this.registry.set('offlineReport', offline);
    }

    setProgress(1, 'Descending...');
    store.save();
    this.time.delayedCall(firstRun ? 3200 : 400, () => {
      this.scene.start('WorldScene');
    });
  }
}
