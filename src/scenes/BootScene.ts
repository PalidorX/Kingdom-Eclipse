// Boot: guest start, no sign-up wall, no logo splash. The camera settles on
// the player's real neighbourhood as fast as the data allows (doc s.2).

import Phaser from 'phaser';
import { ZOOM } from '../core/zoom';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { geo } from '../core/geo';
import { getMapData } from '../core/osm';
import { store } from '../core/save';

export class BootScene extends Phaser.Scene {
  constructor() { super({ key: 'BootScene' }); }

  preload(): void {
    // __BUILD_TS__ busts stale image caches on each deploy
    this.load.image('world-tileset', `${import.meta.env.BASE_URL}assets/world-tileset.png?v=${__BUILD_TS__}`);
    this.load.spritesheet('crystal', `${import.meta.env.BASE_URL}assets/crystal.png?v=${__BUILD_TS__}`, { frameWidth: 32, frameHeight: 48 });
    this.load.image('clouds', `${import.meta.env.BASE_URL}assets/clouds.png?v=${__BUILD_TS__}`);
    this.load.image('kobjects', `${import.meta.env.BASE_URL}assets/kingdom-objects.png?v=${__BUILD_TS__}`);
    this.load.image('buildings', `${import.meta.env.BASE_URL}assets/buildings.png?v=${__BUILD_TS__}`);
    this.load.spritesheet('smoke', `${import.meta.env.BASE_URL}assets/smoke.png?v=${__BUILD_TS__}`, { frameWidth: 32, frameHeight: 64 });
  }

  async create(): Promise<void> {
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    store.load();
    const offline = store.collectOffline();

    const status = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, 'finding your street...', {
      fontSize: '11px', color: '#88aacc', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, '◆', {
      fontSize: '40px', color: '#e8c860',
    }).setOrigin(0.5);

    if (store.state.admin.enabled && store.state.admin.pos) {
      geo.setAdmin(store.state.admin.pos);
    }
    await geo.acquire();
    geo.startWatch();

    status.setText('redrawing the world below...');
    const map = await getMapData(geo.pos);
    this.registry.set('mapData', map);
    this.registry.set('offlineReport', offline);

    store.save();
    this.scene.start('WorldScene'); // cold open on their street — no preamble
  }
}
