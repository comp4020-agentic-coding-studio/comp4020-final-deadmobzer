// The 3D table: a self-contained Three.js controller. Give it a container and
// feed it GameState; it renders the board + standees, orbits, and reports clicks
// on tiles/units back out. Pure presentation — it never decides anything; the
// server does. (Heavy lib, client-only — see ADR-002.)
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface TableUnit {
  iid: string; owner: 0 | 1; name: string; art: string;
  pos: { x: number; y: number };
  hp: number; maxHp: number; alive: boolean; isNecromancer: boolean;
}
export interface TableState {
  mapSize: number;
  units: TableUnit[];
  players: { colour: string }[];
}
export interface TableHandlers {
  onPickTile?: (x: number, y: number) => void;
  onPickUnit?: (iid: string) => void;
  onHoverUnit?: (iid: string | null) => void;
}

const TILE = 1;

export class Table {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private loader = new THREE.TextureLoader();
  private standees = new Map<string, THREE.Group>();
  private tileMeshes: THREE.Mesh[] = [];
  private highlights: THREE.Mesh[] = [];
  private size = 8;
  private handlers: TableHandlers;
  private raf = 0;
  private hovered: string | null = null;

  constructor(container: HTMLElement, state: TableState, handlers: TableHandlers = {}) {
    this.handlers = handlers;
    this.size = state.mapSize;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0b0d);

    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    this.camera.position.set(this.size * 0.5, this.size * 0.9, this.size * 1.15);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(this.size / 2 - 0.5, 0, this.size / 2 - 0.5);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 30;

    this.buildLights();
    this.buildBoard();
    this.sync(state);

    this.renderer.domElement.addEventListener("click", this.onClick);
    this.renderer.domElement.addEventListener("pointermove", this.onMove);
    window.addEventListener("resize", this.onResize);
    this.animate();
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.1);
    key.position.set(this.size, this.size * 1.4, this.size * 0.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -this.size; key.shadow.camera.right = this.size;
    key.shadow.camera.top = this.size; key.shadow.camera.bottom = -this.size;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xf00000, 0.25);
    rim.position.set(-this.size, this.size, -this.size);
    this.scene.add(rim);
  }

  private buildBoard(): void {
    const n = this.size;
    // reflective-ish plinth under the board
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(n + 1, 0.4, n + 1),
      new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.35, metalness: 0.6 }),
    );
    plinth.position.set(n / 2 - 0.5, -0.3, n / 2 - 0.5);
    plinth.receiveShadow = true;
    this.scene.add(plinth);

    const light = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.8 });
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(TILE * 0.96, 0.12, TILE * 0.96),
          (x + y) % 2 === 0 ? light : dark,
        );
        tile.position.set(x, 0, y);
        tile.receiveShadow = true;
        tile.userData = { x, y };
        this.scene.add(tile);
        this.tileMeshes.push(tile);
      }
    }
  }

  // Build or update standees to match the state.
  sync(state: TableState): void {
    const seen = new Set<string>();
    for (const u of state.units) {
      if (!u.alive) continue;
      seen.add(u.iid);
      const colour = state.players[u.owner]?.colour ?? "#cccccc";
      let g = this.standees.get(u.iid);
      if (!g) {
        g = this.makeStandee(u, colour);
        this.standees.set(u.iid, g);
        this.scene.add(g);
      }
      g.position.set(u.pos.x, 0, u.pos.y);
      g.userData = { iid: u.iid };
    }
    // remove standees for units no longer present/alive
    for (const [iid, g] of this.standees) {
      if (!seen.has(iid)) { this.scene.remove(g); this.standees.delete(iid); }
    }
  }

  private makeStandee(u: TableUnit, colour: string): THREE.Group {
    const g = new THREE.Group();
    const col = new THREE.Color(colour);
    const r = u.isNecromancer ? 0.42 : 0.34;
    // base: tinted low-poly disc
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.1, 0.16, 16),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.5 }),
    );
    base.position.y = 0.14; base.castShadow = true; base.receiveShadow = true;
    g.add(base);
    // standee: billboard plane with the unit art
    const hgt = u.isNecromancer ? 1.5 : 1.2;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(hgt * 0.75, hgt),
      new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide }),
    );
    plane.position.y = 0.22 + hgt / 2;
    plane.castShadow = true;
    this.loader.load(`/art/${u.art}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      (plane.material as THREE.MeshStandardMaterial).map = tex;
      (plane.material as THREE.MeshStandardMaterial).needsUpdate = true;
    });
    g.add(plane);
    // a thin ring in the team colour to read ownership from above
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.2, 0.04, 8, 24),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 }),
    );
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06;
    g.add(ring);
    g.userData = { iid: u.iid, billboard: plane };
    return g;
  }

  highlightTiles(tiles: { x: number; y: number }[]): void {
    for (const h of this.highlights) this.scene.remove(h);
    this.highlights = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0xf00000, transparent: true, opacity: 0.4, emissive: 0xf00000, emissiveIntensity: 0.4 });
    for (const t of tiles) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.9, 0.04, TILE * 0.9), mat);
      m.position.set(t.x, 0.13, t.y);
      this.scene.add(m);
      this.highlights.push(m);
    }
  }

  private setPointer(e: PointerEvent | MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onClick = (e: MouseEvent): void => {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // units first
    const unitHit = this.raycaster.intersectObjects([...this.standees.values()], true)[0];
    if (unitHit) {
      let o: THREE.Object3D | null = unitHit.object;
      while (o && !o.userData?.iid) o = o.parent;
      if (o?.userData?.iid) { this.handlers.onPickUnit?.(o.userData.iid); return; }
    }
    const tileHit = this.raycaster.intersectObjects(this.tileMeshes)[0];
    if (tileHit) {
      const { x, y } = tileHit.object.userData as { x: number; y: number };
      this.handlers.onPickTile?.(x, y);
    }
  };

  private onMove = (e: PointerEvent): void => {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([...this.standees.values()], true)[0];
    let iid: string | null = null;
    if (hit) { let o: THREE.Object3D | null = hit.object; while (o && !o.userData?.iid) o = o.parent; iid = o?.userData?.iid ?? null; }
    if (iid !== this.hovered) { this.hovered = iid; this.handlers.onHoverUnit?.(iid); }
  };

  private onResize = (): void => {
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    // billboard the art planes toward the camera (horizontal only)
    for (const g of this.standees.values()) {
      const plane = g.userData.billboard as THREE.Mesh | undefined;
      if (plane) plane.rotation.y = Math.atan2(
        this.camera.position.x - g.position.x, this.camera.position.z - g.position.z);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.renderer.domElement.removeEventListener("pointermove", this.onMove);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
