// SPDX-License-Identifier: MIT
'use client';

import React, { useEffect, useRef } from 'react';

/**
 * BackgroundShader: Renders the Stitch Deep Space WebGL atmospheric shader
 * with mouse interaction, starfield noise, and Uniswap Pink / Ethereum Blue nebula.
 */
export const BackgroundShader: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;
    const gl =
      canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' }) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) return;

    function syncSize() {
      if (!canvas) return;
      const w = window.innerWidth || 1280;
      const h = window.innerHeight || 720;
      // Downscale slightly for smooth 60fps performance
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const targetW = Math.floor(w * pixelRatio);
      const targetH = Math.floor(h * pixelRatio);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    }

    syncSize();
    window.addEventListener('resize', syncSize);

    const vs = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fs = `
      precision highp float;
      varying vec2 v_texCoord;
      uniform float u_time;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;

      float noise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec2 uv = v_texCoord;
        vec3 color = vec3(0.051, 0.055, 0.082); // Base Deep Space #0D0E15

        // Subtle distant star field
        float stars = pow(noise(uv * 120.0), 22.0);
        color += stars * 0.35;

        // Interactive mouse offset factor
        vec2 normMouse = u_mouse / max(u_resolution, vec2(1.0, 1.0));
        vec2 mOffset = (normMouse - 0.5) * 0.1;

        // Uniswap Pink Nebula Glow (#FF007A)
        float nebula = sin((uv.x + mOffset.x) * 2.2 + u_time * 0.12) * 0.5 + 0.5;
        nebula *= cos((uv.y + mOffset.y) * 2.8 - u_time * 0.08) * 0.5 + 0.5;
        color += vec3(1.0, 0.0, 0.48) * nebula * 0.045;

        // Ethereum Blue Atmosphere Shift (#4C82FB)
        float blueShift = sin((uv.y - mOffset.y) * 1.8 + u_time * 0.1) * 0.5 + 0.5;
        color += vec3(0.3, 0.51, 0.98) * blueShift * 0.035;

        // Subtle vignette at viewport edges
        float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
        vignette = clamp(pow(16.0 * vignette, 0.25), 0.0, 1.0);
        color *= (0.7 + 0.3 * vignette);

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    function createShader(glCtx: WebGLRenderingContext, type: number, source: string) {
      const s = glCtx.createShader(type);
      if (!s) return null;
      glCtx.shaderSource(s, source);
      glCtx.compileShader(s);
      if (!glCtx.getShaderParameter(s, glCtx.COMPILE_STATUS)) {
        glCtx.deleteShader(s);
        return null;
      }
      return s;
    }

    const vert = createShader(gl, gl.VERTEX_SHADER, vs);
    const frag = createShader(gl, gl.FRAGMENT_SHADER, fs);
    if (!vert || !frag) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return;
    }

    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const pos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');

    let mouse = { x: canvas.width / 2, y: canvas.height / 2 };

    const handleMouseMove = (event: MouseEvent) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = 1.0 - (event.clientY - rect.top) / rect.height;
        mouse.x = nx * canvas.width;
        mouse.y = ny * canvas.height;
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    let startTime = performance.now();

    function render(time: number) {
      if (!gl || !canvas) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      const elapsed = (time - startTime) * 0.001;

      if (uTime) gl.uniform1f(uTime, elapsed);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', syncSize);
      window.removeEventListener('mousemove', handleMouseMove);
      if (gl && prog) {
        gl.deleteProgram(prog);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none -z-10 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full block opacity-75 transition-opacity duration-1000"
        aria-hidden="true"
      />
    </div>
  );
};
