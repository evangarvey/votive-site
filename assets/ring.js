// Votive ring: a 3D relief of the spiked votive ring, built from the reference photo itself
// (img2threejs "projection-first fidelity": the photo's own pixels are the surface).
//   - silhouette: cut from the photo (the ring is darker than the grey studio ground)
//   - shape: rounded edges from a distance field of that silhouette, plus relief from the photo's light and shade
//   - surface: the photo as colour (partly de-lit), a roughness map, studio-environment reflections
// The back is a mirrored guess (one view only). Spec and review: Site/logo-3d/.
// Interaction: faces front and sways, tilts toward the pointer, drag to spin, click/tap for a turn.
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const PHOTO = new URL('./ring-photo.png', import.meta.url).href;

function loadImage(src) {
	return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Separable box blur on a Float32Array image (w×h), r = radius in px.
function blur(src, w, h, r) {
	const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
	for (let y = 0; y < h; y++) {
		let s = 0;
		for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
		for (let x = 0; x < w; x++) {
			tmp[y * w + x] = s / n;
			s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
		}
	}
	for (let x = 0; x < w; x++) {
		let s = 0;
		for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
		for (let y = 0; y < h; y++) {
			out[y * w + x] = s / n;
			s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
		}
	}
	return out;
}

// Two-pass chamfer distance (in px) from every masked pixel to the nearest unmasked one.
function distanceField(mask, w, h) {
	const INF = 1e9, d = new Float32Array(w * h);
	for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
	const a = 1, b = Math.SQRT2;
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const i = y * w + x; if (!d[i]) continue;
		let v = d[i];
		if (x > 0) v = Math.min(v, d[i - 1] + a);
		if (y > 0) { v = Math.min(v, d[i - w] + a); if (x > 0) v = Math.min(v, d[i - w - 1] + b); if (x < w - 1) v = Math.min(v, d[i - w + 1] + b); }
		d[i] = v;
	}
	for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
		const i = y * w + x; if (!d[i]) continue;
		let v = d[i];
		if (x < w - 1) v = Math.min(v, d[i + 1] + a);
		if (y < h - 1) { v = Math.min(v, d[i + w] + a); if (x < w - 1) v = Math.min(v, d[i + w + 1] + b); if (x > 0) v = Math.min(v, d[i + w - 1] + b); }
		d[i] = v;
	}
	return d;
}

// Keep only the largest 4-connected component of the mask (drops dust and shadow specks).
function largestComponent(mask, w, h) {
	const lab = new Int32Array(w * h), stack = []; let best = 0, bestN = 0, id = 0;
	for (let s = 0; s < mask.length; s++) {
		if (!mask[s] || lab[s]) continue;
		id++; let n = 0; stack.push(s); lab[s] = id;
		while (stack.length) {
			const i = stack.pop(); n++;
			const x = i % w, y = (i / w) | 0;
			if (x > 0 && mask[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack.push(i - 1); }
			if (x < w - 1 && mask[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack.push(i + 1); }
			if (y > 0 && mask[i - w] && !lab[i - w]) { lab[i - w] = id; stack.push(i - w); }
			if (y < h - 1 && mask[i + w] && !lab[i + w]) { lab[i + w] = id; stack.push(i + w); }
		}
		if (n > bestN) { bestN = n; best = id; }
	}
	const out = new Uint8Array(w * h);
	for (let i = 0; i < out.length; i++) out[i] = lab[i] === best ? 1 : 0;
	return out;
}

const canvasTex = (w, h, fill) => {
	const c = document.createElement('canvas'); c.width = w; c.height = h;
	const g = c.getContext('2d'), d = g.createImageData(w, h);
	fill(d.data); g.putImageData(d, 0, 0);
	return new THREE.CanvasTexture(c);
};

export async function createVotiveRing() {
	const img = await loadImage(PHOTO);
	const W = img.width, H = img.height;
	const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
	const cx = cv.getContext('2d', {willReadFrequently: true});
	cx.drawImage(img, 0, 0);
	const px = cx.getImageData(0, 0, W, H).data;

	// Luminance, and a per-row estimate of the studio ground (the photo's background has a soft gradient).
	const lum = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
	const ground = new Float32Array(H);
	for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < 8; x++) s += lum[y * W + x] + lum[y * W + W - 1 - x]; ground[y] = s / 16; }

	// Mask: pixels clearly darker than the ground, smoothed, then only the largest piece.
	let soft = new Float32Array(W * H);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; soft[i] = Math.min(1, Math.max(0, (ground[y] - lum[i] - 0.045) / 0.05)); }
	soft = blur(soft, W, H, 1);
	let mask = new Uint8Array(W * H);
	for (let i = 0; i < mask.length; i++) mask[i] = soft[i] > 0.5 ? 1 : 0;
	mask = largestComponent(mask, W, H);

	// Height: a rounded profile from the distance field (cast metal has soft edges) + relief from the photo.
	const dist = distanceField(mask, W, H);
	const lumBlur = blur(lum, W, H, 6);
	const lumFine = blur(lum, W, H, 1);
	const R = 9; // px over which the edge rounds over
	const height = new Float32Array(W * H);
	for (let i = 0; i < height.length; i++) {
		if (!mask[i]) continue;
		const t = Math.min(1, dist[i] / R);
		const round = Math.sqrt(1 - (1 - t) * (1 - t)); // quarter-circle edge
		const relief = (lumFine[i] - lumBlur[i]) * 2.2; // bright bumps catch light, pits are dark
		height[i] = round * (1 + 0.35 * Math.min(1, dist[i] / 22)) + relief * t;
	}

	// Colour: the photo with its baked-in shading partly removed, so the scene lights don't double it.
	let ms = 0, mn = 0;
	for (let i = 0; i < mask.length; i++) if (mask[i]) { ms += lumBlur[i]; mn++; }
	const meanLum = ms / mn;
	const map = canvasTex(W, H, (d) => {
		for (let i = 0; i < W * H; i++) {
			const k = mask[i] ? Math.min(1.6, Math.max(0.7, meanLum / Math.max(0.05, lumBlur[i]))) : 1;
			const f = 1 + (k - 1) * 0.55;
			d[i * 4] = Math.min(255, px[i * 4] * f); d[i * 4 + 1] = Math.min(255, px[i * 4 + 1] * f); d[i * 4 + 2] = Math.min(255, px[i * 4 + 2] * f); d[i * 4 + 3] = 255;
		}
	});
	map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
	// Roughness: crusty, bright patches rougher; darker worn metal a little smoother.
	const roughnessMap = canvasTex(W, H, (d) => {
		for (let i = 0; i < W * H; i++) { const v = 255 * Math.min(1, Math.max(0.55, 0.62 + (lumFine[i] - meanLum) * 1.2)); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
	});

	// Geometry: one vertex per photo pixel near the ring; front and back sheets meet at height 0 on the edge.
	const S = 1 / H; // world units per px (ring ≈ 1 unit tall)
	const T = 9 * S; // half-thickness at full height
	const near = new Uint8Array(W * H);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		let any = 0;
		for (let oy = -1; oy <= 1 && !any; oy++) for (let ox = -1; ox <= 1; ox++) { const X = x + ox, Y = y + oy; if (X >= 0 && Y >= 0 && X < W && Y < H && mask[Y * W + X]) { any = 1; break; } }
		near[y * W + x] = any;
	}
	const pos = [], uv = [], idx = [], vid = new Int32Array(W * H * 2).fill(-1);
	for (let side = 0; side < 2; side++) {
		const sgn = side ? -1 : 1, o = side * W * H;
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			const i = y * W + x; if (!near[i]) continue;
			vid[o + i] = pos.length / 3;
			pos.push((x - W / 2) * S, (H / 2 - y) * S, sgn * (mask[i] ? height[i] : 0) * T * (side ? 0.92 : 1));
			uv.push(x / (W - 1), 1 - y / (H - 1));
		}
		for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
			const i = y * W + x;
			if (!(mask[i] || mask[i + 1] || mask[i + W] || mask[i + W + 1])) continue;
			const a = vid[o + i], b = vid[o + i + 1], c = vid[o + i + W], d = vid[o + i + W + 1];
			if (a < 0 || b < 0 || c < 0 || d < 0) continue;
			if (side) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	geo.setIndex(idx);
	geo.computeVertexNormals();

	const mat = new THREE.MeshStandardMaterial({map, roughnessMap, roughness: 1, metalness: 0.32, envMapIntensity: 1.0});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'votive-ring';
	return mesh;
}

// Mount the interactive logo into a container element.
export async function mountRing(el, {onReady} = {}) {
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	el.appendChild(renderer.domElement);

	const scene = new THREE.Scene();
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // soft studio reflections
	const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
	camera.position.set(0, 0, 2.25);
	const key = new THREE.DirectionalLight('#fff6ea', 1.4); key.position.set(-1.2, 1.8, 2.2); scene.add(key);
	const rim = new THREE.DirectionalLight('#dde6ec', 0.8); rim.position.set(1.8, -0.6, -1.6); scene.add(rim);
	scene.add(new THREE.AmbientLight('#ffffff', 0.15));

	const pivot = new THREE.Group(); scene.add(pivot);
	pivot.add(await createVotiveRing());

	const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
	new ResizeObserver(resize).observe(el); resize();

	let spin = 0, vel = 0, tiltX = 0, tiltY = 0, aimX = 0, aimY = 0, dragging = false, lastX = 0, moved = 0, t = 0;
	el.addEventListener('pointermove', (e) => {
		const r = el.getBoundingClientRect();
		aimX = ((e.clientY - r.top) / r.height - 0.5) * 0.45; aimY = ((e.clientX - r.left) / r.width - 0.5) * 0.55;
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
		if (pose !== null) {
			pivot.rotation.set(0, (+pose * Math.PI) / 180, 0);
		} else {
			t += 1 / 60;
			if (!dragging) {
				const home = Math.round(spin / (2 * Math.PI)) * 2 * Math.PI + (reduce ? 0 : Math.sin(t * 0.55) * 0.42);
				vel = vel * 0.965 + (home - spin) * (Math.abs(vel) > 0.02 ? 0 : 0.0025);
				spin += vel;
			}
			tiltX += (aimX - tiltX) * 0.06; tiltY += (aimY - tiltY) * 0.06;
			pivot.rotation.set(tiltX, spin + tiltY, 0);
		}
		renderer.render(scene, camera);
		if (first) { first = false; onReady && onReady(); }
	});
	return {renderer, scene, camera};
}
