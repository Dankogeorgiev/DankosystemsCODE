/* Данко Системс — 3D визуализация на праховата линия (конвейр).
   Класически <script>, споделя глобалните променливи на страницата
   (phi, hangers, L, loopPos, boothNum, PAINT, H, anchored, update…).
   Рисува надземен релсов „стадион“ с подвеските по него — толкова,
   колкото са заредени в състава, с номера, състояние (заредена/
   боядисана/празна) и станции ЗАКАЧАНЕ · БОЯДИСВАНЕ · ОТКАЧАНЕ.

   Ако three.js не се зареди (напр. блокиран CDN) — модулът тихо се
   изключва и остава 2D контурът. Всяка грешка при рисуване също връща
   към 2D, за да не блокира страницата. */
(function () {
  "use strict";
  const T = window.THREE;                     // ако липсва → 3D е недостъпно

  // Геометрия на линията (метри) — както в подготвения 3D файл.
  const RAIL_Y = 2.8, STRAIGHT = 8, R = 3;
  const U_OFFSET = 0.30;                       // завърта кабината към зрителя
  const fw = 0.7, fh = 1.1;
  const TwoPI = Math.PI * 2;

  let ready = false, active = false, builtL = -1;
  let scene, camera, renderer, controls, curve, container, ro, ray;
  let downX = 0, downY = 0;
  const groups = [];                           // 3D подвеските
  let metalMat, partGeo, rodGeo, barH, barV, clickGeo;

  const hexNum = h => { h = (h || "").replace("#", ""); return h.length >= 6 ? parseInt(h.slice(0, 6), 16) : 0x999999; };
  const hangerColor = k => hexNum((typeof H === "function" && hangers[k] && H(hangers[k].type) && H(hangers[k].type).color) || "#cccccc");
  const norm = t => { let x = (t + Math.PI) % TwoPI; if (x < 0) x += TwoPI; return x - Math.PI; };

  // ---- надпис като спрайт (за станциите и номерата) ----
  function textSprite(text, bg, fg, wPx) {
    const c = document.createElement("canvas"); c.width = wPx || 256; c.height = 128;
    const ctx = c.getContext("2d");
    if (bg) {
      ctx.fillStyle = bg; roundRect(ctx, 6, 30, c.width - 12, 68, 16); ctx.fill();
    }
    ctx.font = "bold 60px 'Segoe UI',system-ui,sans-serif";
    ctx.fillStyle = fg || "#1F3864"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, c.width / 2, 64);
    const tex = new T.CanvasTexture(c); tex.anisotropy = 4;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.renderOrder = 10;
    return sp;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---- „стадион“ крива на релсата ----
  function stadiumPoints(n) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * i / n; pts.push(new T.Vector3(STRAIGHT + Math.cos(a) * R, RAIL_Y, Math.sin(a) * R)); }
    for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + Math.PI * i / n; pts.push(new T.Vector3(-STRAIGHT + Math.cos(a) * R, RAIL_Y, Math.sin(a) * R)); }
    return pts;
  }

  function buildScene() {
    scene = new T.Scene();
    scene.background = new T.Color(0xeef0ee);
    scene.fog = new T.Fog(0xeef0ee, 42, 95);

    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight || 480);
    camera = new T.PerspectiveCamera(45, w / h, 0.1, 500);
    camera.position.set(18, 14, 21);

    renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    controls = new T.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 9; controls.maxDistance = 60;

    scene.add(new T.HemisphereLight(0xffffff, 0xb8bcb6, 0.85));
    const sun = new T.DirectionalLight(0xffffff, 0.7);
    sun.position.set(16, 26, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
    scene.add(sun);

    const floor = new T.Mesh(new T.PlaneGeometry(60, 40), new T.MeshStandardMaterial({ color: 0xe4e6e2, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const grid = new T.GridHelper(40, 40, 0xc4c2b8, 0xd6d4cc); grid.position.y = 0.01; scene.add(grid);

    curve = new T.CatmullRomCurve3(stadiumPoints(24), true, "catmullrom", 0.0);
    const rail = new T.Mesh(new T.TubeGeometry(curve, 260, 0.09, 14, true),
      new T.MeshStandardMaterial({ color: 0x0F6E56, roughness: 0.45, metalness: 0.5 }));
    rail.castShadow = true; scene.add(rail);
    const beam = new T.Mesh(new T.TubeGeometry(curve, 260, 0.05, 10, true),
      new T.MeshStandardMaterial({ color: 0x8a8c86, roughness: 0.6, metalness: 0.4 }));
    beam.position.y = 0.22; scene.add(beam);

    // колони
    const colMat = new T.MeshStandardMaterial({ color: 0x444441, roughness: 0.6, metalness: 0.6 });
    const baseMat = new T.MeshStandardMaterial({ color: 0x33332f, roughness: 0.8 });
    [-7, 0, 7].forEach(x => [R, -R].forEach(z => {
      const hh = RAIL_Y + 0.22;
      const col = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, hh, 16), colMat);
      col.position.set(x, hh / 2, z); col.castShadow = true; scene.add(col);
      const base = new T.Mesh(new T.BoxGeometry(0.5, 0.08, 0.5), baseMat);
      base.position.set(x, 0.04, z); scene.add(base);
    }));

    // споделени геометрии/материали за подвеските
    metalMat = new T.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 });
    rodGeo = new T.CylinderGeometry(0.025, 0.025, 1.5, 8);
    barH = new T.BoxGeometry(fw, 0.045, 0.045);
    barV = new T.BoxGeometry(0.045, fh, 0.045);
    partGeo = new T.BoxGeometry(0.42, 0.16, 0.02);
    clickGeo = new T.SphereGeometry(0.75, 10, 8);

    addStations();

    ray = new T.Raycaster();
    renderer.domElement.addEventListener("pointerdown", e => { downX = e.clientX; downY = e.clientY; });
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    ro = new ResizeObserver(onResize); ro.observe(container);
  }

  // Станциите стоят на фиксирани позиции по кривата (спрямо кабината).
  function stationU(angle) { return (((angle / TwoPI) % 1) + 1 + U_OFFSET) % 1; }
  function addStation(angle, text, color) {
    const p = curve.getPointAt(stationU(angle));
    const post = new T.Mesh(new T.BoxGeometry(0.12, 1.6, 0.12), new T.MeshStandardMaterial({ color }));
    post.position.set(p.x, RAIL_Y + 0.8, p.z); scene.add(post);
    const sp = textSprite(text, "#" + color.toString(16).padStart(6, "0"), "#ffffff", 512);
    sp.scale.set(3.4, 0.85, 1); sp.position.set(p.x, RAIL_Y + 2.0, p.z); scene.add(sp);
  }
  function addStations() {
    addStation(2.4, "ЗАКАЧАНЕ", 0x2563eb);
    addStation(0.0, "БОЯДИСВАНЕ", 0xdc2626);
    addStation(1.9, "ОТКАЧАНЕ", 0x0d9488);
  }

  function clearGroups() {
    groups.forEach(g => {
      scene.remove(g);
      g.traverse(o => { if (o.material && o.material.map) o.material.map.dispose(); if (o.material) o.material.dispose(); });
    });
    groups.length = 0;
  }
  function buildHangers3D(Lc) {
    clearGroups();
    for (let k = 0; k < Lc; k++) {
      const g = new T.Group();
      const rod = new T.Mesh(rodGeo, metalMat); rod.position.y = RAIL_Y - 0.75; g.add(rod);
      const frame = new T.Group();
      const top = new T.Mesh(barH, metalMat); frame.add(top);
      const bot = new T.Mesh(barH, metalMat); bot.position.y = -fh; frame.add(bot);
      const lft = new T.Mesh(barV, metalMat); lft.position.set(-fw / 2, -fh / 2, 0); frame.add(lft);
      const rgt = new T.Mesh(barV, metalMat); rgt.position.set(fw / 2, -fh / 2, 0); frame.add(rgt);
      const pmat = new T.MeshStandardMaterial({ color: 0xb6bcc2, roughness: 0.6, metalness: 0.3 });
      for (let i = 0; i < 3; i++) { const pc = new T.Mesh(partGeo, pmat); pc.position.set(0, -0.2 - i * 0.32, 0.05); frame.add(pc); }
      frame.position.y = RAIL_Y - 1.5; g.add(frame);
      const cs = new T.Mesh(clickGeo, new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      cs.position.y = RAIL_Y - 1.9; cs.userData.k = k; g.add(cs);
      const label = textSprite(String(k + 1), "#ffffff", "#1F3864", 160);
      label.scale.set(0.85, 0.42, 1); label.position.y = RAIL_Y - 1.25; g.add(label);
      g.userData = { pmat, clickMesh: cs };
      scene.add(g); groups.push(g);
    }
    builtL = Lc;
  }

  function frame() {
    if (!ready || !active) return;
    const Lc = (typeof L === "function") ? L() : 0;
    if (!Lc) { controls.update(); renderer.render(scene, camera); return; }
    if (Lc !== builtL) buildHangers3D(Lc);
    const lp = loopPos(), step = TwoPI / Math.max(1, Lc), cur = Math.floor(lp);
    const paint = hexNum(PAINT());
    for (let k = 0; k < Lc; k++) {
      const g = groups[k]; if (!g) continue;
      const tn = norm(-((k + 1) - lp) * step);
      const u = (((tn / TwoPI) % 1) + 1 + U_OFFSET) % 1;
      const p = curve.getPointAt(u);
      g.position.set(p.x, 0, p.z);
      const st = (tn >= 0 && tn <= 1.9) ? "painted" : ((tn > 1.9 && tn < 2.4) ? "empty" : "loaded");
      const col = st === "painted" ? paint : (st === "empty" ? 0xd7dde3 : hangerColor(k));
      g.userData.pmat.color.setHex(col);
      const isCur = (k === cur);
      g.userData.pmat.emissive.setHex(isCur ? 0x1f3864 : 0x000000);
      g.scale.setScalar(isCur ? 1.16 : 1);
    }
    controls.update();
    renderer.render(scene, camera);
  }

  function onResize() {
    if (!renderer || !container) return;
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight || 480);
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
  }
  function onPointerUp(e) {
    if (typeof anchored !== "undefined" && anchored) return;      // само в покой
    if (Math.abs(e.clientX - downX) > 5 || Math.abs(e.clientY - downY) > 5) return; // било е влачене
    const rect = renderer.domElement.getBoundingClientRect();
    const m = new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects(groups.map(g => g.userData.clickMesh), false)[0];
    if (hit) { phi = hit.object.userData.k; if (typeof update === "function") update(); }
  }

  function init() {
    if (!T || ready) return;
    container = document.getElementById("loop3d");
    if (!container) return;
    buildScene();
    ready = true;
  }

  // ---- публичен интерфейс ----
  function show() {
    if (!T) return;
    try {
      if (!ready) init();
      if (!ready) return;
      active = true;
      const c = document.getElementById("loop3d"), s = document.getElementById("loop");
      if (c) c.hidden = false; if (s) s.hidden = true;
      onResize();
      setToggle(true);
    } catch (e) { fail(e); }
  }
  function hide() {
    active = false;
    const c = document.getElementById("loop3d"), s = document.getElementById("loop");
    if (c) c.hidden = true; if (s) { s.hidden = false; if (typeof drawLoop === "function") drawLoop(); }
    setToggle(false);
  }
  function fail(e) { console.warn("3D визуализация: грешка, връщам 2D", e); hide(); }
  function setToggle(is3d) {
    const b3 = document.getElementById("view3d"), b2 = document.getElementById("view2d");
    if (b3) b3.classList.toggle("on", is3d);
    if (b2) b2.classList.toggle("on", !is3d);
  }

  window.Loop3D = { show, hide, frame, fail, get active() { return active; }, get ready() { return ready; }, available: !!T };

  function wire() {
    const b3 = document.getElementById("view3d"), b2 = document.getElementById("view2d");
    if (b2) b2.onclick = hide;
    if (b3) {
      if (!T) { b3.disabled = true; b3.title = "3D изгледът се нуждае от интернет (three.js)"; }
      else b3.onclick = show;
    }
    if (T) show();          // 3D по подразбиране, когато е налично
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
