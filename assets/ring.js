// Votive ring: a procedural three.js model of the spiked votive ring (reference:
// Content/Designs/Brand/ring-reference.png), built in code — no mesh or photo texture.
// Spec: Site/logo-3d/logo-spec.md. Interaction: slow idle spin, follows the pointer,
// drag (mouse or touch) to spin it with momentum, click/tap for a quick turn.
import * as THREE from 'three';
import {mergeGeometries, mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';

// Seeded random so the ring is the same on every load.
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

// Small 3D value noise for the corroded, lumpy surface.
function makeNoise(seed) {
	const r = rng(seed), p = new Uint8Array(512), v = new Float32Array(256);
	for (let i = 0; i < 256; i++) { p[i] = i; v[i] = r(); }
	for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
	for (let i = 0; i < 256; i++) p[i + 256] = p[i];
	const s = (t) => t * t * (3 - 2 * t);
	const h = (x, y, z) => v[p[p[p[x & 255] + (y & 255)] + (z & 255)]];
	return (x, y, z) => {
		const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = s(x - X), fy = s(y - Y), fz = s(z - Z);
		const l = (a, b, t) => a + (b - a) * t;
		return l(l(l(h(X, Y, Z), h(X + 1, Y, Z), fx), l(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), fx), fy),
			l(l(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), fx), l(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), fx), fy), fz) * 2 - 1;
	};
}

export function createVotiveRing() {
	const rand = rng(23);
	const noise = makeNoise(7);
	const parts = [];

	// 1. Band: a thick, slightly flattened torus (outer r ≈ 0.47, hole r ≈ 0.31).
	const band = new THREE.TorusGeometry(0.39, 0.082, 28, 220);
	band.scale(1, 1, 0.72);
	parts.push(band);

	// 2. Spike crown: 22 short blunt cones around ~300° of the rim, irregular length, lean and spacing.
	const N = 26, gapCenter = -Math.PI / 2, gapHalf = 0.26; // open sector at the bottom where the tang is
	for (let i = 0; i < N; i++) {
		const t = (i + 0.5) / N;
		let a = gapCenter + gapHalf + t * (2 * Math.PI - 2 * gapHalf) + (rand() - 0.5) * 0.08;
		const len = 0.11 + rand() * 0.06, base = 0.038 + rand() * 0.012;
		// Truncated cone with a rounded cap: the real spikes are blunt nubs, not points.
		const cone = new THREE.CylinderGeometry(base * 0.32, base * 1.08, len, 12, 4);
		const cap = new THREE.SphereGeometry(base * 0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
		cap.translate(0, len / 2, 0);
		const merged = mergeGeometries([cone.toNonIndexed(), cap.toNonIndexed()].map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); return g; }));
		cone.copy(merged);
		cone.scale(1, 1, 0.85);
		cone.translate(0, len / 2 + 0.44, 0);
		cone.rotateZ(a - Math.PI / 2 + (rand() - 0.5) * 0.22); // point outward, with a little lean
		cone.rotateX((rand() - 0.5) * 0.25);
		parts.push(cone);
	}

	// 3. Tang: the cast sprue below the ring, tapering down and bending a little to the left.
	const tangPts = [];
	for (let k = 0; k <= 10; k++) { const y = k / 10; tangPts.push(new THREE.Vector2(0.095 * (1 - y) ** 0.7 + 0.016, -y * 0.3)); }
	const tang = new THREE.LatheGeometry(tangPts, 16);
	tang.scale(1, 1, 0.55);
	const tp = tang.attributes.position;
	for (let k = 0; k < tp.count; k++) { const y = -tp.getY(k) / 0.3; tp.setX(k, tp.getX(k) - 0.06 * y * y); }
	tang.translate(0.01, -0.44, 0);
	parts.push(tang);

	// 4. Casting flash: an irregular web filling the inside bottom of the ring above the tang.
	const web = new THREE.Shape();
	web.moveTo(-0.13, -0.33);
	web.quadraticCurveTo(-0.04, -0.28, 0.0, -0.31);
	web.quadraticCurveTo(0.07, -0.27, 0.12, -0.335);
	web.lineTo(0.09, -0.42); web.lineTo(-0.09, -0.42); web.closePath();
	const flash = new THREE.ExtrudeGeometry(web, {depth: 0.035, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 10});
	flash.translate(0, 0, -0.0175);
	parts.push(flash);

	// Merge, then displace along normals for the pitted, lumpy corrosion and paint vertex colours.
	// Strip to position only, weld shared vertices so normals are smooth (no faceted stripes).
	const clean = parts.map((g) => { const n = g.toNonIndexed(); for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k); return n; });
	const geo = mergeVertices(mergeGeometries(clean), 1e-4);
	geo.computeVertexNormals();
	geo.computeVertexNormals();
	const P = geo.attributes.position, Nn = geo.attributes.normal, col = new Float32Array(P.count * 3);
	const lead = new THREE.Color('#8c8f8b'), ochre = new THREE.Color('#bcae92'), dark = new THREE.Color('#5c605f'), light = new THREE.Color('#c9c6bc'), c = new THREE.Color();
	for (let k = 0; k < P.count; k++) {
		const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
		const d = noise(x * 10, y * 10, z * 10) * 0.016 + noise(x * 34, y * 34, z * 34) * 0.007 + noise(x * 95, y * 95, z * 95) * 0.0035;
		P.setXYZ(k, x + Nn.getX(k) * d, y + Nn.getY(k) * d, z + Nn.getZ(k) * d);
		const patch = Math.max(0, noise(x * 5 + 3, y * 5, z * 5) * 1.5 - 0.1) * (0.6 + 0.4 * noise(x * 40, y * 40, z * 40));
		const speck = Math.max(0, noise(x * 120, y * 120, z * 120) - 0.45) * 1.6;
		c.copy(lead).lerp(ochre, Math.min(1, patch * 1.3)).lerp(light, Math.min(0.6, speck)).lerp(dark, Math.max(0, -d * 35) * 0.55);
		col.set([c.r, c.g, c.b], k * 3);
	}
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	geo.computeVertexNormals();

	const mat = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.9, metalness: 0.28});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'votive-ring';
	return mesh;
}

// Mount the interactive logo into a container element.
export function mountRing(el, {onReady} = {}) {
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	el.appendChild(renderer.domElement);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
	camera.position.set(0, 0, 3.4);
	scene.add(new THREE.HemisphereLight('#f4f2ee', '#66645e', 1.25));
	const key = new THREE.DirectionalLight('#ffffff', 1.8); key.position.set(1.5, 2, 2.5); scene.add(key);
	const rim = new THREE.DirectionalLight('#dfe6ea', 1.1); rim.position.set(-2, -1, -1.5); scene.add(rim);

	const pivot = new THREE.Group(); scene.add(pivot);
	const ring = createVotiveRing(); ring.position.y = 0.08; pivot.add(ring);

	const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
	new ResizeObserver(resize).observe(el); resize();

	// Interaction state: spin velocity (drag + inertia), pointer tilt, click impulse.
	let spin = 0, vel = 0, tiltX = 0, tiltY = 0, aimX = 0, aimY = 0, dragging = false, lastX = 0, moved = 0, t = 0;
	el.addEventListener('pointermove', (e) => {
		const r = el.getBoundingClientRect();
		aimX = ((e.clientY - r.top) / r.height - 0.5) * 0.5; aimY = ((e.clientX - r.left) / r.width - 0.5) * 0.6;
		if (dragging) { const dx = e.clientX - lastX; vel = dx * 0.004; spin += dx * 0.01; moved += Math.abs(dx); lastX = e.clientX; }
	});
	el.addEventListener('pointerdown', (e) => { dragging = true; moved = 0; lastX = e.clientX; el.setPointerCapture(e.pointerId); el.classList.add('grabbing'); });
	const up = () => { if (dragging && moved < 4) vel += 0.32; dragging = false; el.classList.remove('grabbing'); };
	el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
	el.addEventListener('pointerleave', () => { aimX = aimY = 0; });
	el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vel += 0.32; } });

	// ?pose=<degrees> freezes the ring at that turn (used for review screenshots).
	const pose = new URLSearchParams(location.search).get('pose');
	if (pose !== null) el.style.transition = 'none';
	let first = true;
	renderer.setAnimationLoop(() => {
		if (pose !== null) { pivot.rotation.set(0, (+pose * Math.PI) / 180, 0); renderer.render(scene, camera); if (first) { first = false; onReady && onReady(); } return; }
		// Idle: face front and sway gently. After a drag or click it coasts, then springs back to the nearest front.
		t += 1 / 60;
		if (!dragging) {
			const home = Math.round(spin / (2 * Math.PI)) * 2 * Math.PI + (reduce ? 0 : Math.sin(t * 0.55) * 0.42);
			vel = vel * 0.965 + (home - spin) * (Math.abs(vel) > 0.02 ? 0 : 0.0025);
			spin += vel;
		}
		tiltX += (aimX - tiltX) * 0.06; tiltY += (aimY - tiltY) * 0.06;
		pivot.rotation.set(tiltX, spin + tiltY, 0);
		renderer.render(scene, camera);
		if (first) { first = false; onReady && onReady(); }
	});
	return {renderer, scene, camera, ring};
}
