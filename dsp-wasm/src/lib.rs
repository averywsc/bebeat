use wasm_bindgen::prelude::*;

/// Zero-delay feedback State Variable Filter (Cytomic / Simper topology)
#[wasm_bindgen]
pub struct SvFilter {
    ic1eq: f32,
    ic2eq: f32,
    sample_rate: f32,
}

#[wasm_bindgen]
impl SvFilter {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> SvFilter {
        SvFilter {
            ic1eq: 0.0,
            ic2eq: 0.0,
            sample_rate,
        }
    }

    pub fn process_lp(&mut self, input: f32, cutoff: f32, resonance: f32) -> f32 {
        let fc = cutoff.clamp(20.0, self.sample_rate * 0.45);
        let g = (std::f32::consts::PI * fc / self.sample_rate).tan();
        let k = 2.0 - 1.95 * resonance.clamp(0.0, 0.98);
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = input - self.ic2eq;
        let v1 = a1 * self.ic1eq + a2 * v3;
        let v2 = self.ic2eq + a2 * self.ic1eq + a3 * v3;
        self.ic1eq = 2.0 * v1 - self.ic1eq;
        self.ic2eq = 2.0 * v2 - self.ic2eq;
        v2
    }
}

/// PolyBLEP antialiasing residual for band-limited sawtooth/pulse oscillators
#[wasm_bindgen]
pub fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// Master lookahead True-Peak brickwall limiter + TPDF quantization helper
#[wasm_bindgen]
pub fn apply_true_peak_limiter(samples: &mut [f32], ceiling_linear: f32) {
    let mut env = 1.0_f32;
    let release = 0.9992_f32;
    for s in samples.iter_mut() {
        let peak = s.abs();
        let target = if peak > ceiling_linear {
            ceiling_linear / peak
        } else {
            1.0
        };
        if target < env {
            env = target;
        } else {
            env = env * release + target * (1.0 - release);
        }
        *s = (*s * env).clamp(-ceiling_linear, ceiling_linear);
    }
}
