// The 3D table: a self-contained Three.js controller. Give it a container and
// feed it GameState; it renders the board + standees, orbits, and reports clicks
// on tiles/units back out. Pure presentation — it never decides anything; the
// server does. (Heavy lib, client-only — see ADR-002.)
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface TableUnit {
  iid: string; owner: 0 | 1; name: string; art: string;
  pos: { x: number; y: number };
  hp: number; maxHp: number; alive: boolean; isNecromancer: boolean;
  activatedThisRound: boolean;
}
export interface TerrainCell {
  wall?: { hp: number }; elevated?: boolean; hazard?: boolean; adverse?: boolean; stairs?: boolean;
}
export interface TableState {
  mapSize: number;
  units: TableUnit[];
  players: { colour: string }[];
  terrain?: Record<string, TerrainCell>;
  corpses?: { x: number; y: number }[];
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

    // Environment map so metallic bases/plinth actually reflect something.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.buildLights();
    this.buildBoard();
    this.buildTerrain(state);
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
    // dim cool fill opposite the key light, so the now-textured tiles don't go
    // flat black in shadow.
    const fill = new THREE.DirectionalLight(0x8090a0, 0.2);
    fill.position.set(-this.size * 0.6, this.size * 0.8, this.size);
    this.scene.add(fill);
  }

  // Tile surface textures, extracted from the rulebook's own art
  // (scripts/extract-board-texture.py) rather than generic stock material.
  private tileTexture(file: string): THREE.Texture {
    const tex = this.loader.load(`/art/board/${file}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
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

    const light = new THREE.MeshStandardMaterial({
      color: 0xe8e4da, roughness: 0.85, map: this.tileTexture("light-tile.png"),
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x454550, roughness: 0.85, map: this.tileTexture("dark-tile.png"),
    });
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

  private buildTerrain(state: TableState): void {
    const t = state.terrain ?? {};
    for (const [k, cell] of Object.entries(t)) {
      const [x, y] = k.split(",").map(Number);
      if (cell.elevated) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.5, 0.96),
          new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.7, metalness: 0.2 }));
        m.position.set(x, 0.3, y); m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
      }
      if (cell.stairs) {
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9),
          new THREE.MeshStandardMaterial({ color: 0x5a5a66, roughness: 0.8 }));
        ramp.position.set(x, 0.42, y); ramp.rotation.x = 0.25; this.scene.add(ramp);
      }
      if (cell.wall) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.9),
          new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.6, metalness: 0.3 }));
        wall.position.set(x, 0.65, y); wall.castShadow = true; wall.receiveShadow = true; this.scene.add(wall);
      }
      if (cell.hazard) {
        const haz = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.96),
          new THREE.MeshStandardMaterial({ color: 0xf00000, emissive: 0xf00000, emissiveIntensity: 0.7, roughness: 0.4 }));
        haz.position.set(x, 0.14, y); this.scene.add(haz);
      }
      if (cell.adverse) {
        const mud = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.96),
          new THREE.MeshStandardMaterial({ color: 0x2b2416, roughness: 1, transparent: true, opacity: 0.85 }));
        mud.position.set(x, 0.14, y); this.scene.add(mud);
      }
    }
  }

  // Build or update standees to match the state.
  sync(state: TableState): void {
    const seen = new Set<string>();
    const benchIndex: Partial<Record<0 | 1, number>> = {};
    for (const u of state.units) {
      if (!u.alive) continue;
      seen.add(u.iid);
      const colour = state.players[u.owner]?.colour ?? "#cccccc";
      // Not yet placed (deploy phase's {x:-1,y:-1} sentinel, src/game/engine.ts
      // createGame): don't render it on the board (it isn't a real tile — every
      // unplaced unit from both sides shares that one coordinate), stack it on a
      // "bench" just off the grid instead, one column outside each side's own
      // edge so it reads as "this side's unplaced units."
      let tx: number, tz: number;
      if (u.pos.x < 0 || u.pos.y < 0) {
        const idx = benchIndex[u.owner] ?? 0;
        benchIndex[u.owner] = idx + 1;
        const bench = this.benchPosition(u.owner, idx);
        tx = bench.x; tz = bench.y;
      } else {
        tx = u.pos.x; tz = u.pos.y;
      }
      let g = this.standees.get(u.iid);
      if (!g) {
        g = this.makeStandee(u, colour);
        g.position.set(tx, 0, tz);
        this.standees.set(u.iid, g);
        this.scene.add(g);
      }
      // animate movement: remember the target; the render loop lerps toward it.
      const { billboard, ringMat, ringColour } = g.userData as {
        billboard: THREE.Mesh; ringMat: THREE.MeshStandardMaterial; ringColour: THREE.Color;
      };
      g.userData = { iid: u.iid, billboard, ringMat, ringColour, tx, tz };
      // grey out an already-moved unit's ring so the board reads who's left to act.
      if (ringMat) {
        const c = u.activatedThisRound ? ringColour.clone().multiplyScalar(0.35) : ringColour;
        ringMat.color.copy(c);
        ringMat.emissive.copy(c);
        ringMat.emissiveIntensity = u.activatedThisRound ? 0.1 : 0.4;
      }
    }
    // remove standees for units no longer present/alive
    for (const [iid, g] of this.standees) {
      if (!seen.has(iid)) { this.scene.remove(g); this.standees.delete(iid); }
    }
    this.syncCorpses(state.corpses ?? []);
  }

  // One column outside the board on each side's own edge (x=-2 for side 0,
  // x=size+1 for side 1), stacked down the z axis — keeps unplaced units
  // visible and clearly off-board without overlapping the grid or each other.
  private benchPosition(owner: 0 | 1, idx: number): { x: number; y: number } {
    return { x: owner === 0 ? -2 : this.size + 1, y: idx * 1.15 };
  }

  private corpseMeshes: THREE.Mesh[] = [];
  private syncCorpses(corpses: { x: number; y: number }[]): void {
    for (const m of this.corpseMeshes) this.scene.remove(m);
    this.corpseMeshes = [];
    for (const c of corpses) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.3, 0.05, 10),
        new THREE.MeshStandardMaterial({ color: 0x6a1010, roughness: 0.9 }),
      );
      m.position.set(c.x, 0.15, c.y);
      m.receiveShadow = true;
      this.scene.add(m);
      this.corpseMeshes.push(m);
    }
  }

  private makeStandee(u: TableUnit, colour: string): THREE.Group {
    const g = new THREE.Group();
    const col = new THREE.Color(colour);
    // base: chess-style — side 0 bone-white, side 1 black (ownership also shown by
    // the team-colour ring + the accent-shifted art).
    const baseCol = u.owner === 0 ? new THREE.Color(0xe8e4da) : new THREE.Color(0x111114);
    const r = u.isNecromancer ? 0.42 : 0.34;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.1, 0.16, 16),
      new THREE.MeshStandardMaterial({ color: baseCol, roughness: 0.5, metalness: 0.3 }),
    );
    base.position.y = 0.14; base.castShadow = true; base.receiveShadow = true;
    g.add(base);
    // standee: billboard plane with the unit art, its accents shifted to the team
    // colour (neutral/dark pixels keep their value; saturated accents recolour).
    const hgt = u.isNecromancer ? 1.5 : 1.2;
    const mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTint = { value: col };
      shader.fragmentShader = "uniform vec3 uTint;\n" + shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         {
           float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
           float mx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
           float mn = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
           float sat = mx - mn;
           vec3 tinted = uTint * (0.30 + l);
           diffuseColor.rgb = mix(diffuseColor.rgb, tinted, clamp(sat * 1.8, 0.0, 0.8));
         }`,
      );
    };
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(hgt * 0.75, hgt), mat);
    plane.position.y = 0.22 + hgt / 2;
    plane.castShadow = true;
    this.loader.load(`/art/${u.art}`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex; mat.needsUpdate = true;
    });
    g.add(plane);
    // a thin ring in the full team colour to read ownership from above; darkened
    // (sync()) once the unit has activated this round, so a glance at the board
    // shows who's left to act.
    const ringMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.2, 0.04, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06;
    g.add(ring);
    g.userData = { iid: u.iid, billboard: plane, ringMat, ringColour: col };
    return g;
  }

  // kind "move" (red) highlights reachable tiles; "target" (amber) highlights
  // valid ability targets; "deploy" (green) highlights legal empty tiles in the
  // deploying side's edge band. Each call clears the previous highlights.
  highlightTiles(tiles: { x: number; y: number }[], kind: "move" | "target" | "deploy" = "move"): void {
    for (const h of this.highlights) this.scene.remove(h);
    this.highlights = [];
    const colour = kind === "target" ? 0xf0c030 : kind === "deploy" ? 0x30c060 : 0xf00000;
    const mat = new THREE.MeshStandardMaterial({ color: colour, transparent: true, opacity: 0.45, emissive: colour, emissiveIntensity: 0.5 });
    const h = kind === "target" ? 0.9 : 0.04;
    for (const t of tiles) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.9, h, TILE * 0.9), mat);
      m.position.set(t.x, kind === "target" ? 0.5 : 0.13, t.y);
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
    // Compare actual intersection distances rather than unconditionally
    // preferring a unit hit: once unplaced units sit off-board on the deploy
    // "bench" (sync()), their standee planes can sit in the same screen-space
    // ray as a far tile the player meant to click, and whichever is physically
    // nearer the camera should win — which is also correct for the ordinary
    // case of a unit standing on the tile you click (the standee is nearer).
    const unitHit = this.raycaster.intersectObjects([...this.standees.values()], true)[0];
    const tileHit = this.raycaster.intersectObjects(this.tileMeshes)[0];
    if (unitHit && (!tileHit || unitHit.distance <= tileHit.distance)) {
      let o: THREE.Object3D | null = unitHit.object;
      while (o && !o.userData?.iid) o = o.parent;
      if (o?.userData?.iid) { this.handlers.onPickUnit?.(o.userData.iid); return; }
    }
    if (tileHit) {
      const { x, y } = tileHit.object.userData as { x: number; y: number };
      this.handlers.onPickTile?.(x, y);
    }
  };

  private onMove = (e: PointerEvent): void => {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects([...this.standees.values()], true)[0];
    const tileHit = this.raycaster.intersectObjects(this.tileMeshes)[0];
    let iid: string | null = null;
    if (hit && (!tileHit || hit.distance <= tileHit.distance)) {
      let o: THREE.Object3D | null = hit.object; while (o && !o.userData?.iid) o = o.parent; iid = o?.userData?.iid ?? null;
    }
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
    for (const g of this.standees.values()) {
      // slide toward target position (animated movement)
      const tx = g.userData.tx as number | undefined;
      const tz = g.userData.tz as number | undefined;
      if (tx !== undefined && tz !== undefined) {
        g.position.x += (tx - g.position.x) * 0.2;
        g.position.z += (tz - g.position.z) * 0.2;
      }
      // billboard the art plane toward the camera (horizontal only)
      const plane = g.userData.billboard as THREE.Mesh | undefined;
      if (plane) plane.rotation.y = Math.atan2(
        this.camera.position.x - g.position.x, this.camera.position.z - g.position.z);
    }
    this.updateDice();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ----- board dice -----
  private dice: { mesh: THREE.Mesh; vx: number; vz: number; vy: number; spin: THREE.Vector3; dead: number }[] = [];

  // Roll `values` as tumbling d6 on the board; the top face shows the server's
  // authoritative value (the animation only presents it, never decides it).
  rollDice(values: number[]): void {
    const n = this.size;
    values.slice(0, 4).forEach((v, i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), this.dieMaterials(v));
      mesh.castShadow = true;
      mesh.position.set(n / 2 - 1 + i * 0.8, 3 + Math.random(), n / 2);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(mesh);
      this.dice.push({ mesh, vx: (Math.random() - 0.5) * 0.04, vz: (Math.random() - 0.5) * 0.04,
        vy: 0, spin: new THREE.Vector3(Math.random() * 0.3, Math.random() * 0.3, Math.random() * 0.3), dead: 180 });
    });
  }

  private updateDice(): void {
    for (const d of this.dice) {
      d.dead--;
      if (d.mesh.position.y > 0.3) { d.vy -= 0.012; d.mesh.position.y += d.vy; d.mesh.rotation.x += d.spin.x; d.mesh.rotation.z += d.spin.z; }
      else { d.mesh.position.y = 0.3; // settle flat, top face up (shows the value)
        d.mesh.rotation.x += (0 - d.mesh.rotation.x) * 0.2; d.mesh.rotation.z += (0 - d.mesh.rotation.z) * 0.2; }
      d.mesh.position.x += d.vx; d.mesh.position.z += d.vz; d.vx *= 0.96; d.vz *= 0.96;
    }
    // pairwise collision: cheap sphere-sphere separation + a soft velocity swap, so
    // up to 4 simultaneously-rolled dice push apart instead of clipping through each
    // other. Not a physics engine — just enough to read as dice bumping on a table.
    const COLLIDE_DIAM = 0.65; // ~ two 0.6 cubes' faces starting to touch
    for (let i = 0; i < this.dice.length; i++) {
      for (let j = i + 1; j < this.dice.length; j++) {
        const a = this.dice[i], b = this.dice[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dy = b.mesh.position.y - a.mesh.position.y;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist === 0 || dist >= COLLIDE_DIAM) continue; // 0 = degenerate overlap, skip for a frame
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        // split the overlap evenly, mostly along the floor plane; only let the
        // vertical component act when a die is meaningfully above another, so this
        // doesn't fight the floor-snap settle logic above.
        const push = (COLLIDE_DIAM - dist) * 0.5;
        const vBias = Math.abs(dy) > 0.15 ? 0.3 : 0.02;
        a.mesh.position.x -= nx * push; a.mesh.position.z -= nz * push; a.mesh.position.y -= ny * push * vBias;
        b.mesh.position.x += nx * push; b.mesh.position.z += nz * push; b.mesh.position.y += ny * push * vBias;
        // soft, slightly-elastic bounce: each die takes most of the other's drift and
        // keeps a little of its own, then damps — same damping style as the `*= 0.96`
        // drift above, just a bit firmer since this can re-apply every frame while
        // two dice are still overlapping.
        const avx = a.vx, avz = a.vz, bvx = b.vx, bvz = b.vz;
        a.vx = (avx * 0.4 + bvx * 0.6) * 0.9; a.vz = (avz * 0.4 + bvz * 0.6) * 0.9;
        b.vx = (bvx * 0.4 + avx * 0.6) * 0.9; b.vz = (bvz * 0.4 + avz * 0.6) * 0.9;
      }
    }
    this.dice = this.dice.filter((d) => { if (d.dead <= 0) { this.scene.remove(d.mesh); return false; } return true; });
  }

  // six box-face materials; +Y (top, index 2) carries the rolled value.
  private dieMaterials(value: number): THREE.MeshStandardMaterial[] {
    const order = [1, 6, value, 7 - value, 3, 4]; // +X,-X,+Y,-Y,+Z,-Z
    return order.map((pips) => new THREE.MeshStandardMaterial({ map: this.pipTexture(pips), roughness: 0.5, metalness: 0.1 }));
  }
  private pipCache = new Map<number, THREE.CanvasTexture>();
  private pipTexture(pips: number): THREE.CanvasTexture {
    const cached = this.pipCache.get(pips);
    if (cached) return cached;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f0f0f0"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#f00000"; g.strokeStyle = "#111"; g.lineWidth = 2; g.strokeRect(1, 1, 62, 62);
    g.fillStyle = "#111";
    const P = [[32, 32]], TL = [16, 16], TR = [48, 16], BL = [16, 48], BR = [48, 48], ML = [16, 32], MR = [48, 32];
    const layouts: Record<number, number[][]> = {
      1: [[32, 32]], 2: [TL, BR], 3: [TL, [32, 32], BR], 4: [TL, TR, BL, BR],
      5: [TL, TR, [32, 32], BL, BR], 6: [TL, TR, ML, MR, BL, BR],
    };
    for (const [x, y] of (layouts[pips] ?? P)) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.pipCache.set(pips, tex); return tex;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.renderer.domElement.removeEventListener("click", this.onClick);
    this.renderer.domElement.removeEventListener("pointermove", this.onMove);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
