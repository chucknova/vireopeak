import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./styles.css";

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

const sections = [...document.querySelectorAll(".section")];
const stage = document.querySelector("[data-stage]");
const progressBar = document.querySelector("[data-progress]");

/* -------------------------------------------------------------------------
 * Each section's background is either a scroll-scrubbed image sequence drawn
 * to a <canvas> (sections 1, 3–7) or a static poster (sections 2 & 8, whose
 * markup stays a <video> showing its poster). Frames live in
 * /media/seq/<seq>/<seq>_0001.jpg …  Every frame of a sequence is preloaded
 * before that section's scrub is enabled; until then its poster shows.
 * ---------------------------------------------------------------------- */
const framePath = (seq, i) =>
  `/media/seq/${seq}/${seq}_${String(i + 1).padStart(4, "0")}.webp`;

const configs = sections.map((section) => {
  const canvas = section.querySelector(".section__canvas");
  if (canvas) {
    const count = parseInt(canvas.dataset.frames, 10) || 0;
    return {
      type: "seq",
      canvas,
      seq: canvas.dataset.seq,
      count,
      frames: new Array(count),
      promises: new Array(count),
      current: -1,
    };
  }
  const video = section.querySelector(".section__video");
  if (video) return { type: "video", el: video }; // looping, not scrubbed
  return { type: "static" };
});

// Draw one frame into a section's canvas using object-fit: cover math.
function drawFrame(cfg, img) {
  const canvas = cfg.canvas;
  if (!canvas || !img || !img.complete || !img.naturalWidth) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
  }
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = cw / ch;
  let dw, dh;
  if (ir > cr) {
    dh = ch;
    dw = ch * ir;
  } else {
    dw = cw;
    dh = cw / ir;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
}

// Has this frame finished loading into usable pixels?
function frameLoaded(cfg, i) {
  const f = cfg.frames[i];
  return f && f.complete && f.naturalWidth > 0;
}

// Draw a sequence at a frame index, falling back to the nearest ALREADY-LOADED
// frame while the rest stream in — so scrubbing works from the very first frame
// and sharpens as more arrive.
function drawIndex(cfg, idx) {
  if (cfg.type !== "seq") return;
  const target = gsap.utils.clamp(0, cfg.count - 1, idx);
  let best = -1;
  for (let d = 0; d < cfg.count; d++) {
    if (target - d >= 0 && frameLoaded(cfg, target - d)) {
      best = target - d;
      break;
    }
    if (target + d < cfg.count && frameLoaded(cfg, target + d)) {
      best = target + d;
      break;
    }
  }
  if (best < 0 || best === cfg.current) return;
  cfg.current = best;
  drawFrame(cfg, cfg.frames[best]);
}

// Kick off loading a single frame (idempotent); returns a promise.
function loadFrame(cfg, i) {
  if (cfg.promises[i]) return cfg.promises[i];
  const img = new Image();
  cfg.frames[i] = img;
  const p = new Promise((resolve) => {
    img.onload = img.onerror = () => resolve();
  });
  cfg.promises[i] = p;
  img.src = framePath(cfg.seq, i);
  return p;
}

// Load a sequence: fetch frame 0 first (fast first paint / crossfade poster),
// then stream the rest. Resolves once frame 0 is ready.
function loadSeq(cfg) {
  const first = loadFrame(cfg, 0);
  first.then(() => {
    for (let i = 1; i < cfg.count; i++) loadFrame(cfg, i);
  });
  return first;
}

/* -------------------------------------------------------------------------
 * Motion layer — every section is pinned in one stacked stage and scrubs its
 * clip over ~150vh of scroll; the scrub target is lerped in a single rAF loop
 * for smoothness, boundaries crossfade in the last 12%, and releasing snaps to
 * the nearest section edge. Skipped under prefers-reduced-motion: no pin, no
 * scrub — every section is a static poster.
 * ---------------------------------------------------------------------- */
// Branded preloader curtain (markup in index.html, styles in styles.css).
const intro = document.querySelector("[data-intro]");
const introMark = document.querySelector("[data-intro-mark]");
const finishIntro = () => intro && intro.classList.add("is-done");

if (prefersReducedMotion) {
  // Static posters everywhere. No large motion: hold the curtain briefly, fade.
  if (intro) {
    setTimeout(
      () =>
        gsap.to(intro, { autoAlpha: 0, duration: 0.5, onComplete: finishIntro }),
      700
    );
  }
} else {
  document.documentElement.classList.add("has-motion");

  // Keep the reveal anchored at the top of the page on refresh.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // Lenis smooth scroll, driven by GSAP's ticker (our single rAF loop).
  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // Lock scroll under the curtain until the reveal completes.
  lenis.scrollTo(0, { immediate: true });
  lenis.stop();

  // Mark entrance while the curtain holds.
  if (introMark) {
    gsap.from(introMark, { opacity: 0, y: 16, duration: 0.6, ease: "power2.out" });
  }

  const N = sections.length;
  // Scroll distance per section, in vh. Higher = slower scrub (more scrolling to
  // play a clip start→finish). One dial for the whole run; can be set per-index.
  const SECTION_VH = 260;
  const DIST = sections.map(() => SECTION_VH);
  const TR_FRAC = 0.12; // last 12% of a section crossfades into the next
  const SCRUB_LERP = 0.1; // smoothing of the scrub target (fast flick → smooth)

  const cum = [0];
  for (let i = 0; i < N; i++) cum[i + 1] = cum[i] + DIST[i];
  const totalVH = cum[N];
  const vhToPx = (vh) => (vh / 100) * window.innerHeight;

  // Stack the sections: later ones on top, starting transparent.
  sections.forEach((section, i) => {
    section.style.zIndex = String(i + 1);
    section.style.opacity = i === 0 ? "1" : "0";
  });

  // Pin the whole stacked run and expose its 0→1 progress (scrub driven below).
  const st = ScrollTrigger.create({
    trigger: stage,
    start: "top top",
    end: () => "+=" + vhToPx(totalVH),
    pin: stage,
    anticipatePin: 1,
    invalidateOnRefresh: true,
  });

  // Eased scroll snap: a short idle after releasing settles to the nearest
  // section start/end (never mid-scrub), routed through Lenis.
  const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const boundariesPx = () => {
    const span = st.end - st.start;
    return cum.map((vh) => st.start + (vh / totalVH) * span);
  };
  let snapTimer = 0;
  const snapToNearest = () => {
    if (!st.isActive) return;
    const cur = lenis.scroll;
    let best = cur;
    let bestD = Infinity;
    for (const b of boundariesPx()) {
      const d = Math.abs(b - cur);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (bestD > 2) lenis.scrollTo(best, { duration: 0.6, easing: easeInOutCubic });
  };
  lenis.on("scroll", () => {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapToNearest, 140);
  });

  // Lazy per-section loading: a sequence's frames are only fetched when we
  // approach it, so the first load is just the hero — not all 55MB at once.
  const loadStarted = new Set();
  const ensureLoaded = (i) => {
    const cfg = configs[i];
    if (!cfg || cfg.type !== "seq" || loadStarted.has(i)) return Promise.resolve();
    loadStarted.add(i);
    return loadSeq(cfg);
  };

  let revealed = false;

  // When the active section changes (and once at reveal): park the incoming
  // sequence on frame 0, warm the next couple of sections, and play only the
  // in-view looping video.
  const applyActive = (active) => {
    const nxt = configs[active + 1];
    if (nxt && nxt.type === "seq") drawIndex(nxt, 0);
    for (let k = active; k <= active + 2; k++) ensureLoaded(k); // warm ahead
    configs.forEach((cfg, k) => {
      if (cfg.type !== "video") return;
      if (k === active || k === active + 1) cfg.el.play().catch(() => {});
      else cfg.el.pause();
    });
  };

  // The single rAF loop: lerp the scrub target, scrub the active sequence, and
  // crossfade the boundary. Ahead-loading and video playback wait until after
  // the reveal so nothing competes with the hero for bandwidth behind curtain.
  let smooth = 0;
  let lastActive = -1;
  gsap.ticker.add(() => {
    smooth += (st.progress - smooth) * SCRUB_LERP;
    const posVH = smooth * totalVH;

    let active = 0;
    while (active < N - 1 && posVH >= cum[active + 1]) active++;
    const local = gsap.utils.clamp(0, 1, (posVH - cum[active]) / DIST[active]);

    const a = configs[active];
    if (a.type === "seq") drawIndex(a, Math.round(local * (a.count - 1)));

    if (active !== lastActive) {
      lastActive = active;
      if (revealed) applyActive(active);
    }

    // Crossfade: incoming fades in over the active section's last 12%.
    const tIn = local > 1 - TR_FRAC ? (local - (1 - TR_FRAC)) / TR_FRAC : 0;
    for (let k = 0; k < N; k++) {
      const op = k <= active ? 1 : k === active + 1 ? tIn : 0;
      sections[k].style.opacity = String(op);
    }
  });

  // Reveal: lift the mark, slide the curtain up, stagger the hero copy in, then
  // hand scrolling back and begin warming the sections ahead. Idempotent +
  // safety-timed so it can't trap the page.
  const heroContent = sections[0].querySelectorAll(".section__content > *");
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    applyActive(0); // now that the hero is up, start warming the next sections
    ScrollTrigger.refresh();
    if (!intro) return lenis.start();
    gsap
      .timeline({
        onComplete: () => {
          finishIntro();
          lenis.start();
        },
      })
      .to(introMark, { y: -28, opacity: 0, duration: 0.5, ease: "power2.in" })
      .to(intro, { yPercent: -100, duration: 1.0, ease: "power4.inOut" }, "-=0.15")
      .from(
        heroContent,
        { y: 24, opacity: 0, duration: 0.85, stagger: 0.12, ease: "power3.out" },
        "-=0.55"
      );
  };

  // The curtain waits on the HERO frames only — fetched with the whole pipe to
  // themselves — plus a short minimum hold.
  Promise.all([ensureLoaded(0), new Promise((r) => setTimeout(r, 700))]).then(
    reveal
  );
  setTimeout(reveal, 6000); // safety — never let the curtain trap the page

  // Redraw current frames on resize (canvas backing store changes).
  window.addEventListener("resize", () => {
    configs.forEach((cfg) => {
      if (cfg.type === "seq" && cfg.current >= 0) {
        const idx = cfg.current;
        cfg.current = -1; // force a redraw at the new size
        drawIndex(cfg, idx);
      }
    });
  });

  // Scroll progress bar over the full (pin-extended) scroll length.
  gsap.to(progressBar, {
    scaleX: 1,
    ease: "none",
    scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
  });
}
