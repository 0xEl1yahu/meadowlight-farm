/**
 * Shared materials. Everything is flat-shaded (faceted normals from screen-space derivatives)
 * for the stylised low-poly look, and instance colours multiply the material colour, so
 * instanced meshes use a white base colour and set per-instance colour with setColorAt.
 */
import * as THREE from 'three';
import { Weather } from '../core/types';

/** Uniforms shared by every swaying material; updated once per frame. */
export const sharedUniforms = {
  uTime: { value: 0 },
  uWindStrength: { value: 1 },
};

const WIND_BY_WEATHER: Readonly<Record<Weather, number>> = {
  [Weather.Sunny]: 1,
  [Weather.Rain]: 1.6,
  [Weather.Storm]: 2.8,
  [Weather.Snow]: 1.3,
};

let windCurrent = 1;

/** Call once per frame. Wind strength eases toward the weather's target over ~1 s. */
export function updateSharedUniforms(elapsedSeconds: number, dtSeconds: number, weather: Weather): void {
  sharedUniforms.uTime.value = elapsedSeconds;
  const target = WIND_BY_WEATHER[weather];
  windCurrent += (target - windCurrent) * (1 - Math.exp(-dtSeconds));
  sharedUniforms.uWindStrength.value = windCurrent;
}

export function createFlatMaterial(
  color: THREE.ColorRepresentation = 0xffffff,
  params: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    ...params,
  });
}

export interface SwayOptions {
  /** Horizontal displacement (world units) at local height 1 under wind strength 1. */
  readonly amplitude: number;
  /** Oscillation speed in radians per second. */
  readonly frequency?: number;
}

/**
 * Flat material whose vertices sway with the wind. Displacement grows with the square of the
 * vertex's local height, so geometry must be authored with its base at y = 0. The phase is
 * offset by the instance's world position (instanceMatrix translation) so neighbouring
 * instances move out of sync.
 */
export function createSwayMaterial(
  color: THREE.ColorRepresentation,
  sway: SwayOptions,
  params: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const material = createFlatMaterial(color, params);
  const amplitude = { value: sway.amplitude };
  const frequency = { value: sway.frequency ?? 1.7 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWindStrength = sharedUniforms.uWindStrength;
    shader.uniforms.uSwayAmplitude = amplitude;
    shader.uniforms.uSwayFrequency = frequency;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uTime;',
          'uniform float uWindStrength;',
          'uniform float uSwayAmplitude;',
          'uniform float uSwayFrequency;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '{',
          '  #ifdef USE_INSTANCING',
          '    vec2 swayOrigin = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);',
          '  #else',
          '    vec2 swayOrigin = vec2(modelMatrix[3][0], modelMatrix[3][2]);',
          '  #endif',
          '  float swayHeight = max(position.y, 0.0);',
          '  float swayPhase = uTime * uSwayFrequency + dot(swayOrigin, vec2(0.61, 0.37));',
          '  float swayAmount = uSwayAmplitude * uWindStrength * swayHeight * swayHeight;',
          '  transformed.x += sin(swayPhase) * swayAmount;',
          '  transformed.z += cos(swayPhase * 0.83 + 1.3) * swayAmount * 0.6;',
          '}',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'meadowlight-sway-v1';
  return material;
}

/**
 * Name of the per-vertex float that marks which vertices the instance colour tints: 1 where the
 * instance colour multiplies the baked vertex colour (petals, canopies), 0 where the baked vertex
 * colour is kept as is (stems, leaves, trunks).
 */
export const TINT_MASK_ATTRIBUTE = 'tintMask';

/**
 * A swaying material (see {@link createSwayMaterial}) for geometry that bakes real colours in
 * `color` and carries TINT_MASK_ATTRIBUTE: only masked vertices take the instance colour. Used by
 * meadow flowers (tinted petals) and forest trees (tinted canopy on a baked trunk).
 */
export function createTintMaskSwayMaterial(sway: SwayOptions): THREE.MeshStandardMaterial {
  const material = createSwayMaterial(0xffffff, sway, { vertexColors: true });
  const applySway = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    applySway.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', ['#include <common>', `attribute float ${TINT_MASK_ATTRIBUTE};`].join('\n'))
      .replace(
        '#include <color_vertex>',
        [
          '#include <color_vertex>',
          '#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )',
          `  vColor.rgb = mix( color.rgb, vColor.rgb, ${TINT_MASK_ATTRIBUTE} );`,
          '#endif',
        ].join('\n'),
      );
  };
  // Distinct from the plain sway key: the shader source differs, so the program must not be shared.
  material.customProgramCacheKey = () => 'meadowlight-sway-tintmask-v1';
  return material;
}
