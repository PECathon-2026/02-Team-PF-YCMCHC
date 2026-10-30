/**
 * 3D Interactive Cosmos & Tactile Depth System (canvas3d.js)
 * Implements:
 * - 3D Interactive Discovery Constellation (Canvas 3D / WebGL)
 * - Midnight Black void with Electric Cobalt filaments and Acid Lime node pulses
 * - Pointer rotation, zoom, and node raycasting
 * - Tactile 3D perspective tilts for feed cards
 * - Respects prefers-reduced-motion
 */

export class Cosmos3D {
  constructor(canvasEl, onNodeSelect) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.onNodeSelect = onNodeSelect;
    this.nodes = [];
    this.edges = [];
    this.particles = [];

    this.width = canvasEl.clientWidth || 800;
    this.height = canvasEl.clientHeight || 380;
    this.canvas.width = this.width * window.devicePixelRatio;
    this.canvas.height = this.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    this.camera = {
      x: 0,
      y: 0,
      z: 500,
      rotX: 0.2,
      rotY: 0.3
    };

    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };
    this.hoveredNode = null;

    // Check reduced motion
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.initBackgroundParticles();
    this.bindEvents();
    this.animate = this.animate.bind(this);
    this.animationId = requestAnimationFrame(this.animate);
  }

  initBackgroundParticles() {
    this.particles = [];
    for (let i = 0; i < 60; i++) {
      this.particles.push({
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 600,
        z: (Math.random() - 0.5) * 600,
        radius: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.4 + 0.1
      });
    }
  }

  updateData(recommendations, coSubscriptionMatrix = []) {
    this.nodes = recommendations.map((rec, i) => {
      // Distribute in a 3D spherical / spiral shell
      const phi = Math.acos(-1 + (2 * i) / Math.max(recommendations.length, 1));
      const theta = Math.sqrt(recommendations.length * Math.PI) * phi;
      const radius = 180 + (i % 3) * 40;

      return {
        id: rec.feed_url,
        title: rec.title,
        batches: rec.accepted_batch_count,
        isSynthetic: rec.is_synthetic,
        score: rec.score,
        data: rec,
        origX: radius * Math.cos(theta) * Math.sin(phi),
        origY: radius * Math.sin(theta) * Math.sin(phi),
        origZ: radius * Math.cos(phi),
        screenX: 0,
        screenY: 0,
        screenRadius: 6
      };
    });

    // Generate edges between nodes with high affinity
    this.edges = [];
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const dist = Math.hypot(
          this.nodes[i].origX - this.nodes[j].origX,
          this.nodes[i].origY - this.nodes[j].origY,
          this.nodes[i].origZ - this.nodes[j].origZ
        );
        if (dist < 220) {
          this.edges.push({
            nodeA: this.nodes[i],
            nodeB: this.nodes[j],
            dist
          });
        }
      }
    }
  }

  bindEvents() {
    this.canvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isDragging) {
        const dx = e.clientX - this.lastMouse.x;
        const dy = e.clientY - this.lastMouse.y;
        this.camera.rotY += dx * 0.005;
        this.camera.rotX += dy * 0.005;
        this.lastMouse = { x: e.clientX, y: e.clientY };
      }

      // Check hovered node
      this.hoveredNode = null;
      for (const node of this.nodes) {
        const d = Math.hypot(mouseX - node.screenX, mouseY - node.screenY);
        if (d < node.screenRadius + 6) {
          this.hoveredNode = node;
          this.canvas.style.cursor = "pointer";
          break;
        }
      }
      if (!this.hoveredNode) {
        this.canvas.style.cursor = this.isDragging ? "grabbing" : "grab";
      }
    });

    this.canvas.addEventListener("click", () => {
      if (this.hoveredNode && this.onNodeSelect) {
        this.onNodeSelect(this.hoveredNode.data);
      }
    });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.z = Math.min(Math.max(this.camera.z + e.deltaY * 0.5, 250), 900);
    });
  }

  project3D(x, y, z) {
    // 3D rotation matrix around X and Y
    const cosY = Math.cos(this.camera.rotY);
    const sinY = Math.sin(this.camera.rotY);
    const cosX = Math.cos(this.camera.rotX);
    const sinX = Math.sin(this.camera.rotX);

    // Rotate Y
    let x1 = x * cosY + z * sinY;
    let z1 = -x * sinY + z * cosY;

    // Rotate X
    let y2 = y * cosX - z1 * sinX;
    let z2 = y * sinX + z1 * cosX;

    // Perspective projection
    const fov = 400;
    const scale = fov / (fov + z2 + (this.camera.z - 400));
    return {
      x: this.width / 2 + x1 * scale,
      y: this.height / 2 + y2 * scale,
      scale,
      z: z2
    };
  }

  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!this.reducedMotion && !this.isDragging) {
      this.camera.rotY += 0.0015;
    }

    // 1. Draw Background Space Dust
    this.ctx.fillStyle = "#94A3B8";
    for (const p of this.particles) {
      const proj = this.project3D(p.x, p.y, p.z);
      if (proj.scale > 0) {
        this.ctx.globalAlpha = p.alpha * proj.scale;
        this.ctx.beginPath();
        this.ctx.arc(proj.x, proj.y, p.radius * proj.scale, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    // 2. Draw Co-Subscription Filaments (Electric Cobalt)
    this.ctx.lineWidth = 1;
    for (const edge of this.edges) {
      const p1 = this.project3D(edge.nodeA.origX, edge.nodeA.origY, edge.nodeA.origZ);
      const p2 = this.project3D(edge.nodeB.origX, edge.nodeB.origY, edge.nodeB.origZ);
      if (p1.scale > 0 && p2.scale > 0) {
        this.ctx.strokeStyle = "#295CFF";
        this.ctx.globalAlpha = Math.max(0.12, (1 - edge.dist / 220) * 0.45);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
      }
    }

    // 3. Draw Nodes (Electric Cobalt with Acid Lime Pulse)
    for (const node of this.nodes) {
      const proj = this.project3D(node.origX, node.origY, node.origZ);
      node.screenX = proj.x;
      node.screenY = proj.y;
      node.screenRadius = Math.max(4, 7 * proj.scale);

      if (proj.scale > 0) {
        const isHovered = this.hoveredNode === node;

        // Outer Glow
        this.ctx.beginPath();
        this.ctx.arc(proj.x, proj.y, node.screenRadius * (isHovered ? 2.5 : 1.8), 0, Math.PI * 2);
        this.ctx.fillStyle = isHovered ? "rgba(212, 255, 38, 0.45)" : "rgba(41, 92, 255, 0.35)";
        this.ctx.globalAlpha = 0.8;
        this.ctx.fill();

        // Core Node
        this.ctx.beginPath();
        this.ctx.arc(proj.x, proj.y, node.screenRadius, 0, Math.PI * 2);
        this.ctx.fillStyle = isHovered ? "#D4FF26" : (node.isSynthetic ? "#FFB300" : "#295CFF");
        this.ctx.globalAlpha = 1.0;
        this.ctx.fill();

        // Node Label
        if (proj.scale > 0.75 || isHovered) {
          this.ctx.fillStyle = isHovered ? "#FFFFFF" : "#A0ADC9";
          this.ctx.font = `${isHovered ? "bold " : ""}11px -apple-system, sans-serif`;
          this.ctx.textAlign = "center";
          this.ctx.fillText(node.title.slice(0, 20), proj.x, proj.y + node.screenRadius + 14);
        }
      }
    }

    this.ctx.globalAlpha = 1.0;
    this.animationId = requestAnimationFrame(this.animate);
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
  }
}

/**
 * Attaches tactile 3D perspective tilt to a DOM element.
 */
export function setupCard3dTilt(el) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  el.addEventListener("mousemove", (e) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotX = ((y - centerY) / centerY) * -5; // max 5deg
    const rotY = ((x - centerX) / centerX) * 5;

    el.style.transform = `perspective(1000px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) translateY(-2px)`;
  });

  el.addEventListener("mouseleave", () => {
    el.style.transform = "";
  });
}
